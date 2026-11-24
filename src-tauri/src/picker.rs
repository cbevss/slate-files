//! Experimental: Slate as other apps' Open / Save dialog (Windows only).
//!
//! The `slate_dialog` DLL (see /dialog) is registered per user as the
//! provider of the system file dialogs. When an app shows one, the DLL sends
//! a request over a named pipe; Slate opens a picker window, and the chosen
//! paths go back the same way. Any failure falls back to the real dialog.

use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::Sender;
use std::sync::Mutex;

#[cfg_attr(not(windows), allow(dead_code))]
struct Pending {
    request: Value,
    reply: Sender<String>,
}

static PENDING: Mutex<Option<HashMap<u64, Pending>>> = Mutex::new(None);
#[cfg_attr(not(windows), allow(dead_code))]
static NEXT: AtomicU64 = AtomicU64::new(1);

fn with<R>(f: impl FnOnce(&mut HashMap<u64, Pending>) -> R) -> R {
    let mut g = PENDING.lock().unwrap_or_else(|e| e.into_inner());
    f(g.get_or_insert_with(HashMap::new))
}

/// How many apps are waiting on a Slate picker right now.
pub fn active() -> usize {
    with(|m| m.len())
}

pub fn request(id: u64) -> Option<Value> {
    with(|m| m.get(&id).map(|p| p.request.clone()))
}

/// Send the answer back to the waiting app. Empty `paths` means cancelled.
pub fn finish(id: u64, paths: Vec<String>, type_index: Option<u32>) {
    if let Some(p) = with(|m| m.remove(&id)) {
        let line = if paths.is_empty() {
            serde_json::json!({ "ok": false }).to_string()
        } else {
            serde_json::json!({ "ok": true, "paths": paths, "type_index": type_index }).to_string()
        };
        let _ = p.reply.send(line);
    }
}

pub fn enabled() -> bool {
    cfg!(windows) && crate::settings::get_bool("picker", false)
}

#[cfg(windows)]
pub use imp::{ensure_registered, serve, set_enabled};

#[cfg(not(windows))]
pub fn set_enabled(_app: &tauri::AppHandle, _on: bool) -> Result<(), String> {
    Err("This is only available on Windows.".into())
}

#[cfg(windows)]
mod imp {
    use super::*;
    use std::io::{BufRead, BufReader, Write};
    use std::os::windows::io::FromRawHandle;
    use std::path::{Path, PathBuf};
    use tauri::{AppHandle, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder};
    use windows::core::HSTRING;
    use windows::Win32::Foundation::*;
    use windows::Win32::Storage::FileSystem::*;
    use windows::Win32::System::Pipes::*;
    use winreg::enums::*;
    use winreg::RegKey;

    const OPEN: &str = "{DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7}";
    const SAVE: &str = "{C0B4E2F3-BA21-4773-8DBA-335EC946EB8B}";

    fn pipe_name() -> String {
        let user = std::env::var("USERNAME").unwrap_or_else(|_| "user".into());
        format!(r"\\.\pipe\slate-picker-{}", user.replace(['\\', '/', ' '], "_"))
    }

    /// Listen for picker requests for as long as Slate runs.
    pub fn serve(app: AppHandle) {
        std::thread::spawn(move || {
            let name = HSTRING::from(pipe_name());
            loop {
                let h = unsafe {
                    CreateNamedPipeW(
                        &name,
                        PIPE_ACCESS_DUPLEX,
                        PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS,
                        PIPE_UNLIMITED_INSTANCES,
                        64 * 1024,
                        64 * 1024,
                        0,
                        None,
                    )
                };
                if h.is_invalid() {
                    std::thread::sleep(std::time::Duration::from_secs(2));
                    continue;
                }
                let connected = unsafe { ConnectNamedPipe(h, None) }.is_ok() || unsafe { GetLastError() } == ERROR_PIPE_CONNECTED;
                if !connected {
                    let _ = unsafe { CloseHandle(h) };
                    continue;
                }
                let file = unsafe { std::fs::File::from_raw_handle(h.0) };
                let app = app.clone();
                std::thread::spawn(move || handle(app, file));
            }
        });
    }

    fn handle(app: AppHandle, file: std::fs::File) {
        let mut line = String::new();
        if BufReader::new(&file).read_line(&mut line).is_err() {
            return;
        }
        let mut out = &file;
        // Turned off but still registered (shouldn't happen): tell the DLL to
        // use the real dialog.
        let Ok(request) = serde_json::from_str::<Value>(line.trim()) else { return };
        if !enabled() {
            let _ = out.write_all(b"fallback\n");
            return;
        }
        let id = NEXT.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = std::sync::mpsc::channel();
        with(|m| m.insert(id, Pending { request: request.clone(), reply: tx }));
        if open_window(&app, id, &request).is_err() {
            with(|m| m.remove(&id));
            let _ = out.write_all(b"fallback\n");
            return;
        }
        let reply = rx.recv().unwrap_or_else(|_| r#"{"ok":false}"#.into());
        let _ = out.write_all(reply.as_bytes());
        let _ = out.write_all(b"\n");
        let _ = out.flush();
    }

    fn open_window(app: &AppHandle, id: u64, req: &Value) -> tauri::Result<()> {
        let mode = req["mode"].as_str().unwrap_or("open");
        let title = req["title"].as_str().map(str::to_string).unwrap_or_else(|| match mode {
            "save" => "Save as".into(),
            "folder" => "Choose a folder".into(),
            _ => "Open".into(),
        });
        let label = format!("picker-{id}");
        let w = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
            .initialization_script(&format!("window.__SLATE_PICKER__ = {id};"))
            .title(format!("{title} · Slate"))
            .inner_size(1120.0, 720.0)
            .min_inner_size(760.0, 480.0)
            .decorations(false)
            .background_color(tauri::webview::Color(0, 0, 0, 255))
            .always_on_top(true)
            .visible(false)
            .build()?;
        // centre on the app that asked
        if let Some([l, t, r, b]) = req["owner"].as_array().and_then(|a| {
            let v: Vec<i64> = a.iter().filter_map(|x| x.as_i64()).collect();
            (v.len() == 4).then(|| [v[0], v[1], v[2], v[3]])
        }) {
            if let Ok(size) = w.outer_size() {
                let x = (l + r) / 2 - size.width as i64 / 2;
                let y = (t + b) / 2 - size.height as i64 / 2;
                let _ = w.set_position(PhysicalPosition::new(x as i32, y.max(0) as i32));
            }
        } else {
            let _ = w.center();
        }
        let _ = w.show();
        let _ = w.set_focus();
        let window = w.clone();
        w.on_window_event(move |e| {
            if let tauri::WindowEvent::Destroyed = e {
                finish(id, vec![], None);
            }
            let _ = &window;
        });
        Ok(())
    }

    /* ---------- registration ---------- */

    /// Outside the install folder on purpose: the installer owns that folder
    /// (and its own copies of the DLL), and if Slate is uninstalled while this
    /// is on, apps still find the DLL, can't reach Slate, and quietly show the
    /// Windows dialog instead of failing to create one.
    fn store_dir() -> Option<PathBuf> {
        dirs::data_local_dir().map(|d| d.join("SlateDialog"))
    }

    fn bundled(app: &AppHandle, arch: &str) -> Option<PathBuf> {
        let name = format!("slate_dialog_{arch}.dll");
        let mut tries = vec![];
        if let Ok(r) = app.path().resource_dir() {
            tries.push(r.join("dialog").join(&name));
            tries.push(r.join("resources").join("dialog").join(&name));
        }
        if let Ok(exe) = std::env::current_exe() {
            if let Some(d) = exe.parent() {
                tries.push(d.join("dialog").join(&name));
            }
        }
        tries.into_iter().find(|p| p.exists())
    }

    /// Apps keep the DLL loaded, so each version gets its own file and old
    /// ones are removed once nothing has them open.
    fn install_copy(src: &Path, arch: &str, version: &str) -> Result<PathBuf, String> {
        let dir = store_dir().ok_or("No app data folder available.")?;
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let dest = dir.join(format!("slate_dialog_{arch}_{version}.dll"));
        if !dest.exists() {
            std::fs::copy(src, &dest).map_err(|e| format!("Couldn't copy the dialog component: {e}"))?;
        }
        Ok(dest)
    }

    fn cleanup(keep: &[PathBuf]) {
        if let Some(dir) = store_dir() {
            if let Ok(rd) = std::fs::read_dir(dir) {
                for e in rd.flatten() {
                    let p = e.path();
                    if !keep.contains(&p) {
                        let _ = std::fs::remove_file(p); // fails while an app has it loaded; fine
                    }
                }
            }
        }
    }

    fn classes(wow: bool) -> String {
        if wow { r"Software\Classes\WOW6432Node\CLSID".into() } else { r"Software\Classes\CLSID".into() }
    }

    fn register(dll: &Path, wow: bool) -> Result<(), String> {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let e = |x: std::io::Error| format!("Couldn't update the registry: {x}");
        for (clsid, name) in [(OPEN, "Slate Open dialog"), (SAVE, "Slate Save dialog")] {
            let (k, _) = hkcu.create_subkey(format!(r"{}\{clsid}", classes(wow))).map_err(e)?;
            k.set_value("", &name).map_err(e)?;
            let (srv, _) = k.create_subkey("InprocServer32").map_err(e)?;
            srv.set_value("", &dll.to_string_lossy().to_string()).map_err(e)?;
            srv.set_value("ThreadingModel", &"Apartment").map_err(e)?;
        }
        Ok(())
    }

    /// Remove our keys, and only ours.
    fn unregister() {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        for wow in [false, true] {
            for clsid in [OPEN, SAVE] {
                let path = format!(r"{}\{clsid}", classes(wow));
                let ours = hkcu
                    .open_subkey(format!(r"{path}\InprocServer32"))
                    .and_then(|k| k.get_value::<String, _>(""))
                    .map(|v| v.to_lowercase().contains("slate_dialog"))
                    .unwrap_or(false);
                if ours {
                    let _ = hkcu.delete_subkey_all(&path);
                }
            }
        }
    }

    fn registered_path() -> Option<String> {
        RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey(format!(r"{}\{OPEN}\InprocServer32", classes(false)))
            .and_then(|k| k.get_value::<String, _>(""))
            .ok()
    }

    pub fn set_enabled(app: &AppHandle, on: bool) -> Result<(), String> {
        if !on {
            unregister();
            cleanup(&[]);
            return crate::settings::set("picker", false.into());
        }
        let version = app.package_info().version.to_string();
        let x64 = bundled(app, "x64").ok_or("The dialog component isn't included in this copy of Slate. Install Slate with the installer to use this.")?;
        let mut keep = vec![install_copy(&x64, "x64", &version)?];
        register(&keep[0], false)?;
        if let Some(x86) = bundled(app, "x86") {
            let p = install_copy(&x86, "x86", &version)?;
            register(&p, true)?;
            keep.push(p);
        }
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let (k, _) = RegKey::predef(HKEY_CURRENT_USER).create_subkey(r"Software\Slate").map_err(|e| e.to_string())?;
        k.set_value("PickerHost", &exe.to_string_lossy().to_string()).map_err(|e| e.to_string())?;
        cleanup(&keep);
        crate::settings::set("picker", true.into())
    }

    /// After an update, point the registration at this version's DLL.
    pub fn ensure_registered(app: &AppHandle) {
        if !enabled() {
            return;
        }
        let version = app.package_info().version.to_string();
        let current = registered_path().map(|p| p.contains(&format!("_{version}.dll"))).unwrap_or(false);
        let exe_ok = RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey(r"Software\Slate")
            .and_then(|k| k.get_value::<String, _>("PickerHost"))
            .ok()
            .zip(std::env::current_exe().ok())
            .map(|(a, b)| PathBuf::from(a) == b)
            .unwrap_or(false);
        if !current || !exe_ok {
            let _ = set_enabled(app, true);
        }
    }
}
