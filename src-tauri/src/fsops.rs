//! Directory listing, drives, places and single-item file operations.

use rayon::prelude::*;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use sysinfo::Disks;

#[derive(Serialize, Clone)]
pub struct Entry {
    pub name: String,
    pub path: String,
    pub dir: bool,
    pub size: u64,
    pub mtime: Option<u64>,
    pub hidden: bool,
}

#[derive(Serialize)]
pub struct Drive {
    pub id: String,
    pub label: String,
    pub icon: &'static str,
    pub total: u64,
    pub free: u64,
}

#[derive(Serialize)]
pub struct Place {
    pub label: &'static str,
    pub path: String,
    pub icon: &'static str,
}

/// UI paths use "C:" for a Windows drive root; the OS needs "C:\".
pub fn os_path(p: &str) -> PathBuf {
    #[cfg(windows)]
    {
        if p.len() == 2 && p.ends_with(':') {
            return PathBuf::from(format!("{p}\\"));
        }
    }
    PathBuf::from(p)
}

/// Inverse of `os_path`: strip the trailing separator from Windows drive roots.
pub fn ui_path(p: &Path) -> String {
    let s = p.to_string_lossy().to_string();
    #[cfg(windows)]
    {
        if s.len() == 3 && s.ends_with(":\\") {
            return s[..2].to_string();
        }
    }
    s
}

fn mtime_ms(md: &fs::Metadata) -> Option<u64> {
    md.modified().ok()?.duration_since(UNIX_EPOCH).ok().map(|d| d.as_millis() as u64)
}

#[cfg(windows)]
fn is_hidden(_name: &str, md: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const HIDDEN: u32 = 0x2;
    const SYSTEM: u32 = 0x4;
    md.file_attributes() & (HIDDEN | SYSTEM) != 0
}

#[cfg(not(windows))]
fn is_hidden(name: &str, _md: &fs::Metadata) -> bool {
    name.starts_with('.')
}

pub fn list_dir(path: &str) -> Result<Vec<Entry>, String> {
    let dir = os_path(path);
    let rd = fs::read_dir(&dir).map_err(|e| friendly(&e, path))?;
    let items: Vec<fs::DirEntry> = rd.filter_map(Result::ok).collect();
    Ok(items
        .par_iter()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            let mut md = e.metadata().ok()?;
            if md.file_type().is_symlink() {
                if let Ok(t) = fs::metadata(e.path()) {
                    md = t;
                }
            }
            Some(Entry {
                path: ui_path(&e.path()),
                dir: md.is_dir(),
                size: if md.is_dir() { 0 } else { md.len() },
                mtime: mtime_ms(&md),
                hidden: is_hidden(&name, &md),
                name,
            })
        })
        .collect())
}

pub fn friendly(e: &std::io::Error, path: &str) -> String {
    use std::io::ErrorKind::*;
    match e.kind() {
        NotFound => format!("{path} no longer exists. It may have been moved or deleted."),
        PermissionDenied => format!("You don't have permission to open {path}."),
        AlreadyExists => format!("An item with that name already exists in {path}."),
        _ => format!("{path}: {e}"),
    }
}

pub fn drives() -> Vec<Drive> {
    let disks = Disks::new_with_refreshed_list();
    let mut out: Vec<Drive> = Vec::new();
    for d in disks.list() {
        let mp = d.mount_point().to_string_lossy().to_string();
        #[cfg(windows)]
        let (id, label) = {
            let id = mp.trim_end_matches('\\').to_string();
            let name = d.name().to_string_lossy().to_string();
            let name = if name.is_empty() { if d.is_removable() { "USB Drive".into() } else { "Local Disk".into() } } else { name };
            (id.clone(), format!("{name} ({id})"))
        };
        #[cfg(not(windows))]
        let (id, label) = {
            let keep = mp == "/" || mp.starts_with("/run/media/") || mp.starts_with("/media/") || mp.starts_with("/mnt/") || d.is_removable();
            if !keep {
                continue;
            }
            let label = if mp == "/" {
                "File System".to_string()
            } else {
                Path::new(&mp).file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or(mp.clone())
            };
            (mp.clone(), label)
        };
        if out.iter().any(|x| x.id == id) {
            continue;
        }
        out.push(Drive { id, label, icon: if d.is_removable() { "usb" } else { "drive" }, total: d.total_space(), free: d.available_space() });
    }
    out.sort_by(|a, b| a.id.cmp(&b.id));
    out
}

pub fn free_space(path: &str) -> u64 {
    let p = os_path(path);
    let disks = Disks::new_with_refreshed_list();
    disks
        .list()
        .iter()
        .filter(|d| p.starts_with(d.mount_point()))
        .max_by_key(|d| d.mount_point().as_os_str().len())
        .map(|d| d.available_space())
        .unwrap_or(0)
}

pub fn places() -> Vec<Place> {
    let mut v = Vec::new();
    let mut push = |label: &'static str, p: Option<PathBuf>, icon: &'static str| {
        if let Some(p) = p {
            if p.is_dir() {
                v.push(Place { label, path: ui_path(&p), icon });
            }
        }
    };
    push("Home", dirs::home_dir(), "home");
    push("Desktop", dirs::desktop_dir(), "desktop");
    push("Documents", dirs::document_dir(), "doc");
    push("Downloads", dirs::download_dir(), "download");
    push("Pictures", dirs::picture_dir(), "image");
    push("Music", dirs::audio_dir(), "audio");
    push("Videos", dirs::video_dir(), "video");
    v
}

pub fn valid_name(name: &str) -> Result<(), String> {
    let bad: &[char] = if cfg!(windows) { &['\\', '/', ':', '*', '?', '"', '<', '>', '|'] } else { &['/'] };
    if name.trim().is_empty() || name == "." || name == ".." {
        return Err("Enter a name.".into());
    }
    if name.contains(bad) {
        return Err(if cfg!(windows) { "Names can't contain \\ / : * ? \" < > |".into() } else { "Names can't contain /".into() });
    }
    Ok(())
}

pub fn rename(path: &str, new_name: &str) -> Result<String, String> {
    valid_name(new_name)?;
    let src = os_path(path);
    let dst = src.with_file_name(new_name);
    if dst.exists() && !same_ignoring_case(&src, &dst) {
        return Err(format!("There's already an item called {new_name} here."));
    }
    fs::rename(&src, &dst).map_err(|e| friendly(&e, path))?;
    Ok(ui_path(&dst))
}

fn same_ignoring_case(a: &Path, b: &Path) -> bool {
    cfg!(windows) && a.to_string_lossy().to_lowercase() == b.to_string_lossy().to_lowercase()
}

/// Pick "name", then "name (2)", "name (3)"… so nothing is ever overwritten.
pub fn unique_child(dir: &Path, name: &str, is_dir: bool) -> PathBuf {
    let first = dir.join(name);
    if !first.exists() {
        return first;
    }
    let (stem, ext) = match (is_dir, name.rfind('.')) {
        (false, Some(i)) if i > 0 => (&name[..i], &name[i..]),
        _ => (name, ""),
    };
    (2..)
        .map(|n| dir.join(format!("{stem} ({n}){ext}")))
        .find(|p| !p.exists())
        .unwrap()
}

pub fn mkdir(parent: &str, name: &str) -> Result<String, String> {
    valid_name(name)?;
    let p = unique_child(&os_path(parent), name, true);
    fs::create_dir(&p).map_err(|e| friendly(&e, parent))?;
    Ok(ui_path(&p))
}

pub fn delete_permanent(paths: &[String]) -> Result<(), String> {
    for p in paths {
        let op = os_path(p);
        let md = fs::symlink_metadata(&op).map_err(|e| friendly(&e, p))?;
        if md.is_dir() { fs::remove_dir_all(&op) } else { fs::remove_file(&op) }.map_err(|e| friendly(&e, p))?;
    }
    Ok(())
}

pub fn trash(paths: &[String]) -> Result<(), String> {
    let ps: Vec<PathBuf> = paths.iter().map(|p| os_path(p)).collect();
    trash::delete_all(&ps).map_err(|e| format!("Couldn't move to the Recycle Bin: {e}"))
}

#[cfg(any(windows, all(unix, not(target_os = "macos"))))]
pub fn restore(paths: &[String]) -> Result<usize, String> {
    let want: Vec<PathBuf> = paths.iter().map(|p| os_path(p)).collect();
    let mut items = trash::os_limited::list().map_err(|e| e.to_string())?;
    items.sort_by(|a, b| b.time_deleted.cmp(&a.time_deleted));
    let mut picked = Vec::new();
    for w in &want {
        if let Some(i) = items.iter().position(|it| &it.original_path() == w) {
            picked.push(items.remove(i));
        }
    }
    let n = picked.len();
    trash::os_limited::restore_all(picked).map_err(|e| format!("Couldn't restore: {e:?}"))?;
    Ok(n)
}

#[derive(Serialize, Default)]
pub struct DirSize {
    pub bytes: u64,
    pub files: u64,
    pub dirs: u64,
}

pub fn dir_size(path: &str) -> DirSize {
    let mut s = DirSize::default();
    for e in jwalk::WalkDir::new(os_path(path)).skip_hidden(false).follow_links(false).into_iter().flatten() {
        if e.file_type().is_dir() {
            s.dirs += 1;
        } else if let Ok(md) = e.metadata() {
            s.files += 1;
            s.bytes += md.len();
        }
    }
    s.dirs = s.dirs.saturating_sub(1);
    s
}

pub fn sha256(path: &str) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    use std::io::Read;
    let mut f = fs::File::open(os_path(path)).map_err(|e| friendly(&e, path))?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = f.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(h.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

/// Duplicate finder: group by size, then by SHA-256 of files that share a size.
#[derive(Serialize)]
pub struct DupGroup {
    pub size: u64,
    pub paths: Vec<String>,
}

pub fn duplicates(path: &str, min_size: u64) -> Vec<DupGroup> {
    use std::collections::HashMap;
    let mut by_size: HashMap<u64, Vec<PathBuf>> = HashMap::new();
    for e in jwalk::WalkDir::new(os_path(path)).skip_hidden(false).into_iter().flatten() {
        if e.file_type().is_file() {
            if let Ok(md) = e.metadata() {
                if md.len() >= min_size {
                    by_size.entry(md.len()).or_default().push(e.path());
                }
            }
        }
    }
    let mut groups: Vec<DupGroup> = by_size
        .into_par_iter()
        .filter(|(_, v)| v.len() > 1)
        .flat_map_iter(|(size, v)| {
            let mut by_hash: HashMap<String, Vec<String>> = HashMap::new();
            for p in v {
                let ps = ui_path(&p);
                if let Ok(h) = sha256(&ps) {
                    by_hash.entry(h).or_default().push(ps);
                }
            }
            by_hash.into_values().filter(|g| g.len() > 1).map(move |paths| DupGroup { size, paths }).collect::<Vec<_>>()
        })
        .collect();
    groups.sort_by(|a, b| (b.size * b.paths.len() as u64).cmp(&(a.size * a.paths.len() as u64)));
    groups
}
