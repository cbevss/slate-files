//! Copy and move engine.
//!
//! Why it is fast:
//! - Same-volume moves are a single rename, so they're instant whatever the size.
//! - Small files are copied in parallel (8 workers) with the OS's native copy
//!   (CopyFileExW on Windows; copy_file_range on Linux, which reflinks on btrfs).
//! - Large files stream in big chunks. On Linux each chunk still goes through
//!   copy_file_range, so data never passes through user space.
//! - There's no slow pre-scan dialog: the plan is built with a parallel walk,
//!   and progress starts straight away.

use crate::fsops::{os_path, ui_path, unique_child};
use rayon::prelude::*;
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

const SMALL: u64 = 16 * 1024 * 1024;
const CHUNK: u64 = 32 * 1024 * 1024;

#[derive(Default)]
pub struct Ctl {
    cancel: AtomicBool,
    pause: AtomicBool,
}

#[derive(Default)]
pub struct Transfers {
    next: AtomicU64,
    ctl: Mutex<HashMap<u64, Arc<Ctl>>>,
}

#[derive(Serialize, Clone)]
pub struct Moved {
    pub from: String,
    pub to: String,
}

#[derive(Serialize, Clone)]
pub struct Progress {
    pub id: u64,
    pub state: &'static str, // "running" | "paused" | "done" | "cancelled" | "error"
    pub done: u64,
    pub total: u64,
    pub files_done: u64,
    pub files_total: u64,
    pub bytes_per_sec: f64,
    pub items: Vec<Moved>,
    pub errors: Vec<String>,
}

struct Job {
    src: PathBuf,
    dst: PathBuf,
    size: u64,
}

impl Transfers {
    pub fn set_paused(&self, id: u64, paused: bool) {
        if let Some(c) = self.ctl.lock().unwrap().get(&id) {
            c.pause.store(paused, Ordering::SeqCst);
        }
    }
    pub fn cancel(&self, id: u64) {
        if let Some(c) = self.ctl.lock().unwrap().get(&id) {
            c.cancel.store(true, Ordering::SeqCst);
            c.pause.store(false, Ordering::SeqCst);
        }
    }

    pub fn start(self: &Arc<Self>, app: AppHandle, mode: String, sources: Vec<String>, dest: String) -> Result<u64, String> {
        let dest_dir = os_path(&dest);
        if !dest_dir.is_dir() {
            return Err(format!("{dest} isn't a folder you can copy into."));
        }
        for s in &sources {
            let sp = os_path(s);
            if dest_dir.starts_with(&sp) {
                let name = sp.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
                return Err(format!("Can't {mode} {name} into itself."));
            }
        }
        let id = self.next.fetch_add(1, Ordering::SeqCst) + 1;
        let ctl = Arc::new(Ctl::default());
        self.ctl.lock().unwrap().insert(id, ctl.clone());
        let me = self.clone();
        std::thread::spawn(move || {
            let p = run(&app, id, &ctl, mode == "move", &sources, &dest_dir);
            let _ = app.emit("transfer", p);
            me.ctl.lock().unwrap().remove(&id);
        });
        Ok(id)
    }
}

fn wait_if_paused(ctl: &Ctl) -> bool {
    while ctl.pause.load(Ordering::Relaxed) {
        if ctl.cancel.load(Ordering::Relaxed) {
            return false;
        }
        std::thread::sleep(Duration::from_millis(60));
    }
    !ctl.cancel.load(Ordering::Relaxed)
}

fn run(app: &AppHandle, id: u64, ctl: &Arc<Ctl>, is_move: bool, sources: &[String], dest: &Path) -> Progress {
    let mut items: Vec<Moved> = Vec::new();
    let mut errors: Vec<String> = Vec::new();
    let mut jobs: Vec<Job> = Vec::new();
    let mut dirs_to_make: Vec<PathBuf> = Vec::new();
    let mut move_cleanup: Vec<PathBuf> = Vec::new();

    for s in sources {
        let src = os_path(s);
        let Ok(md) = fs::symlink_metadata(&src) else {
            errors.push(format!("{s} no longer exists."));
            continue;
        };
        let name = src.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        if is_move && src.parent() == Some(dest) {
            continue; // already there
        }
        let target = unique_child(dest, &name, md.is_dir());
        // Same volume: a move is just a rename.
        if is_move && fs::rename(&src, &target).is_ok() {
            items.push(Moved { from: ui_path(&src), to: ui_path(&target) });
            continue;
        }
        items.push(Moved { from: ui_path(&src), to: ui_path(&target) });
        if md.is_dir() {
            dirs_to_make.push(target.clone());
            for e in jwalk::WalkDir::new(&src).skip_hidden(false).follow_links(false).into_iter().flatten() {
                let rel = match e.path().strip_prefix(&src) { Ok(r) => r.to_path_buf(), Err(_) => continue };
                if rel.as_os_str().is_empty() {
                    continue;
                }
                let out = target.join(&rel);
                if e.file_type().is_dir() {
                    dirs_to_make.push(out);
                } else if let Ok(m) = e.metadata() {
                    jobs.push(Job { src: e.path(), dst: out, size: m.len() });
                }
            }
        } else {
            jobs.push(Job { src: src.clone(), dst: target, size: md.len() });
        }
        if is_move {
            move_cleanup.push(src);
        }
    }

    let total: u64 = jobs.iter().map(|j| j.size).sum();
    let files_total = jobs.len() as u64;
    let done = Arc::new(AtomicU64::new(0));
    let files_done = Arc::new(AtomicU64::new(0));
    let finished = Arc::new(AtomicBool::new(false));

    // progress reporter
    let reporter = {
        let (app, done, files_done, finished, ctl) = (app.clone(), done.clone(), files_done.clone(), finished.clone(), ctl.clone());
        std::thread::spawn(move || {
            let mut last = (Instant::now(), 0u64);
            let mut rate = 0f64;
            while !finished.load(Ordering::Relaxed) {
                std::thread::sleep(Duration::from_millis(120));
                let d = done.load(Ordering::Relaxed);
                let dt = last.0.elapsed().as_secs_f64();
                if dt > 0.0 {
                    let inst = (d - last.1) as f64 / dt;
                    rate = if rate == 0.0 { inst } else { rate * 0.75 + inst * 0.25 };
                }
                last = (Instant::now(), d);
                let _ = app.emit("transfer", Progress {
                    id,
                    state: if ctl.pause.load(Ordering::Relaxed) { "paused" } else { "running" },
                    done: d,
                    total,
                    files_done: files_done.load(Ordering::Relaxed),
                    files_total,
                    bytes_per_sec: rate,
                    items: vec![],
                    errors: vec![],
                });
            }
        })
    };

    for d in &dirs_to_make {
        if let Err(e) = fs::create_dir_all(d) {
            errors.push(format!("{}: {e}", d.display()));
        }
    }

    let errs = Mutex::new(Vec::<String>::new());
    let (small, large): (Vec<&Job>, Vec<&Job>) = jobs.iter().partition(|j| j.size < SMALL);
    let pool = rayon::ThreadPoolBuilder::new().num_threads(8).build().unwrap();
    pool.install(|| {
        small.par_iter().for_each(|j| {
            if !wait_if_paused(ctl) {
                return;
            }
            match fs::copy(&j.src, &j.dst) {
                Ok(n) => {
                    done.fetch_add(n, Ordering::Relaxed);
                }
                Err(e) => errs.lock().unwrap().push(format!("{}: {e}", j.src.display())),
            }
            files_done.fetch_add(1, Ordering::Relaxed);
        });
    });
    for j in large {
        if !wait_if_paused(ctl) {
            break;
        }
        if let Err(e) = copy_large(j, ctl, &done) {
            let _ = fs::remove_file(&j.dst);
            if !ctl.cancel.load(Ordering::Relaxed) {
                errs.lock().unwrap().push(format!("{}: {e}", j.src.display()));
            }
        }
        files_done.fetch_add(1, Ordering::Relaxed);
    }
    errors.extend(errs.into_inner().unwrap());

    let cancelled = ctl.cancel.load(Ordering::Relaxed);
    if cancelled {
        // leave nothing half-done: remove what this transfer created
        for it in &items {
            let p = os_path(&it.to);
            if !is_move || p.exists() && os_path(&it.from).exists() {
                let _ = if p.is_dir() { fs::remove_dir_all(&p) } else { fs::remove_file(&p) };
            }
        }
    } else if is_move && errors.is_empty() {
        for s in move_cleanup {
            let r = if s.is_dir() { fs::remove_dir_all(&s) } else { fs::remove_file(&s) };
            if let Err(e) = r {
                errors.push(format!("Copied, but couldn't remove {}: {e}", s.display()));
            }
        }
    }

    finished.store(true, Ordering::Relaxed);
    let _ = reporter.join();
    Progress {
        id,
        state: if cancelled { "cancelled" } else if errors.is_empty() { "done" } else { "error" },
        done: done.load(Ordering::Relaxed),
        total,
        files_done: files_done.load(Ordering::Relaxed),
        files_total,
        bytes_per_sec: 0.0,
        items: if cancelled { vec![] } else { items },
        errors,
    }
}

fn copy_large(j: &Job, ctl: &Ctl, done: &AtomicU64) -> std::io::Result<()> {
    let mut src = fs::File::open(&j.src)?;
    let mut dst = fs::File::create(&j.dst)?;
    let md = src.metadata()?;
    let _ = dst.set_len(md.len()); // preallocate so the filesystem can lay it out contiguously
    #[cfg(target_os = "linux")]
    {
        // io::copy on File->File uses copy_file_range (zero-copy, reflink on btrfs)
        loop {
            if !wait_if_paused(ctl) {
                return Err(std::io::Error::new(std::io::ErrorKind::Interrupted, "cancelled"));
            }
            let n = std::io::copy(&mut (&mut src).take(CHUNK), &mut dst)?;
            if n == 0 {
                break;
            }
            done.fetch_add(n, Ordering::Relaxed);
        }
    }
    #[cfg(not(target_os = "linux"))]
    {
        let mut buf = vec![0u8; 8 * 1024 * 1024];
        let _ = CHUNK;
        loop {
            if !wait_if_paused(ctl) {
                return Err(std::io::Error::new(std::io::ErrorKind::Interrupted, "cancelled"));
            }
            let n = src.read(&mut buf)?;
            if n == 0 {
                break;
            }
            dst.write_all(&buf[..n])?;
            done.fetch_add(n as u64, Ordering::Relaxed);
        }
    }
    dst.flush()?;
    if let Ok(t) = md.modified() {
        let _ = dst.set_modified(t);
    }
    let _ = fs::set_permissions(&j.dst, md.permissions());
    Ok(())
}
