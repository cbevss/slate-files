//! In-memory filename index for instant search.
//!
//! The index is a flat tree: every node stores its name and its parent's slot,
//! so millions of entries cost a few dozen bytes each and full paths are only
//! rebuilt for the results we actually return. Building walks every root in
//! parallel; searching scans all names in parallel.

use crate::fsops::{os_path, ui_path};
use rayon::prelude::*;
use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, RwLock};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

const ROOT: u32 = u32::MAX;

struct Node {
    parent: u32,
    lower: Box<str>,
    name: Box<str>,
    dir: bool,
}

#[derive(Serialize, Clone, Default)]
pub struct Status {
    pub building: bool,
    pub count: usize,
    pub build_ms: u64,
    pub built_at: Option<u64>,
}

#[derive(Serialize)]
pub struct Hit {
    pub name: String,
    pub path: String,
    pub parent: String,
    pub dir: bool,
}

#[derive(Serialize)]
pub struct Results {
    pub hits: Vec<Hit>,
    pub total: usize,
    pub ms: f64,
    pub indexed: usize,
    pub building: bool,
}

#[derive(Default)]
pub struct Index {
    nodes: RwLock<Vec<Node>>,
    status: RwLock<Status>,
    busy: AtomicBool,
}

fn skip(name: &str, depth: usize) -> bool {
    if name.starts_with('$') || name == "System Volume Information" || name == "node_modules" || name == ".git" {
        return true;
    }
    if cfg!(windows) && depth == 0 && (name == "Windows" || name == "ProgramData" || name == "Recovery") {
        return true;
    }
    if cfg!(not(windows)) && (name == ".cache" || name == "Trash" || name == ".local" && depth == 0) {
        return true;
    }
    false
}

/// What gets indexed: every fixed and removable drive on Windows; the home
/// folder plus mounted media on Linux (never /proc, /sys and friends).
fn roots() -> Vec<PathBuf> {
    if cfg!(windows) {
        crate::fsops::drives().into_iter().map(|d| os_path(&d.id)).collect()
    } else {
        let mut r: Vec<PathBuf> = dirs::home_dir().into_iter().collect();
        for d in crate::fsops::drives() {
            if d.id != "/" {
                r.push(PathBuf::from(d.id));
            }
        }
        r
    }
}

fn walk<'s>(s: &rayon::Scope<'s>, dir: PathBuf, idx: u32, depth: usize, nodes: &'s Mutex<Vec<Node>>) {
    let Ok(rd) = fs::read_dir(&dir) else { return };
    let mut batch: Vec<(String, bool)> = Vec::new();
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        let Ok(ft) = e.file_type() else { continue };
        let is_dir = ft.is_dir();
        if is_dir && skip(&name, depth) {
            continue;
        }
        batch.push((name, is_dir));
    }
    let base = {
        let mut n = nodes.lock().unwrap();
        let base = n.len() as u32;
        for (name, d) in &batch {
            n.push(Node { parent: idx, lower: name.to_lowercase().into(), name: name.as_str().into(), dir: *d });
        }
        base
    };
    for (i, (name, d)) in batch.into_iter().enumerate() {
        if d {
            let path = dir.join(&name);
            s.spawn(move |s| walk(s, path, base + i as u32, depth + 1, nodes));
        }
    }
}

impl Index {
    pub fn status(&self) -> Status {
        self.status.read().unwrap().clone()
    }

    pub fn rebuild(&self) {
        if self.busy.swap(true, Ordering::SeqCst) {
            return;
        }
        self.status.write().unwrap().building = true;
        let t0 = Instant::now();
        let nodes = Mutex::new(Vec::<Node>::with_capacity(1 << 20));
        let roots = roots();
        rayon::scope(|s| {
            let nodes = &nodes;
            for r in roots {
                let idx = {
                    let mut n = nodes.lock().unwrap();
                    n.push(Node { parent: ROOT, lower: "".into(), name: ui_path(&r).into(), dir: true });
                    (n.len() - 1) as u32
                };
                s.spawn(move |s| walk(s, r, idx, 0, nodes));
            }
        });
        let nodes = nodes.into_inner().unwrap();
        let count = nodes.len();
        *self.nodes.write().unwrap() = nodes;
        *self.status.write().unwrap() = Status {
            building: false,
            count,
            build_ms: t0.elapsed().as_millis() as u64,
            built_at: SystemTime::now().duration_since(UNIX_EPOCH).ok().map(|d| d.as_millis() as u64),
        };
        self.busy.store(false, Ordering::SeqCst);
    }

    fn path_of(nodes: &[Node], mut i: u32) -> String {
        let mut parts: Vec<&str> = Vec::new();
        while i != ROOT {
            let n = &nodes[i as usize];
            parts.push(&n.name);
            i = n.parent;
        }
        parts.reverse();
        let mut p = PathBuf::from(parts[0]);
        if cfg!(windows) && parts[0].len() == 2 {
            p = PathBuf::from(format!("{}\\", parts[0]));
        }
        for s in &parts[1..] {
            p.push(s);
        }
        ui_path(&p)
    }

    pub fn search(&self, query: &str, limit: usize) -> Results {
        let t0 = Instant::now();
        let terms: Vec<String> = query.to_lowercase().split_whitespace().map(String::from).collect();
        let nodes = self.nodes.read().unwrap();
        let building = self.status.read().unwrap().building;
        if terms.is_empty() {
            return Results { hits: vec![], total: 0, ms: 0.0, indexed: nodes.len(), building };
        }
        let first = &terms[0];
        let mut found: Vec<(u8, bool, usize, u32)> = nodes
            .par_iter()
            .enumerate()
            .filter_map(|(i, n)| {
                if n.parent == ROOT {
                    return None;
                }
                let at = n.lower.find(first.as_str())?;
                if !terms[1..].iter().all(|t| n.lower.contains(t.as_str())) {
                    return None;
                }
                let rank = if at == 0 {
                    0
                } else if matches!(n.lower.as_bytes()[at - 1], b' ' | b'.' | b'_' | b'-') {
                    1
                } else {
                    2
                };
                Some((rank, !n.dir, n.name.len(), i as u32))
            })
            .collect();
        let total = found.len();
        if found.len() > limit {
            found.select_nth_unstable(limit);
            found.truncate(limit);
        }
        found.sort_unstable();
        let hits = found
            .into_iter()
            .map(|(_, _, _, i)| {
                let n = &nodes[i as usize];
                let path = Self::path_of(&nodes, i);
                Hit { name: n.name.to_string(), parent: Self::path_of(&nodes, n.parent), path, dir: n.dir }
            })
            .collect();
        Results { hits, total, ms: t0.elapsed().as_secs_f64() * 1000.0, indexed: nodes.len(), building }
    }
}
