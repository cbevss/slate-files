mod default_app;
mod fsops;
mod icons;
mod index;
mod picker;
mod settings;
mod transfer;
mod update;

/// Started by the dialog component to serve an Open/Save request: run
/// without showing the main window.
fn picker_host() -> bool {
    std::env::args().any(|a| a == "--picker-host")
}

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tauri::{Emitter, Manager, State};

/// The folder a launch asked for, e.g. `slate.exe "D:\Photos"` from Explorer's
/// "Open in Slate" or a file manager handler. A file opens its folder.
fn path_from_args<I: IntoIterator<Item = String>>(args: I) -> Option<String> {
    let arg = args.into_iter().skip(1).find(|a| !a.starts_with('-') && !a.is_empty())?;
    let p = PathBuf::from(arg.trim_matches('"'));
    let p = if p.is_file() { p.parent()?.to_path_buf() } else { p };
    if !p.is_dir() {
        return None;
    }
    let s = p.to_string_lossy().to_string();
    let trimmed = if s.len() > 3 { s.trim_end_matches(['\\', '/']).to_string() } else { s };
    Some(fsops::ui_path(&PathBuf::from(trimmed)))
}

#[tauri::command]
fn startup_path() -> Option<String> {
    path_from_args(std::env::args())
}

#[tauri::command]
fn default_status() -> bool {
    default_app::is_default()
}

#[tauri::command]
async fn set_default(enable: bool) -> Result<(), String> {
    blocking(move || default_app::set(enable)).await?
}

struct App {
    index: Arc<index::Index>,
    transfers: Arc<transfer::Transfers>,
}

/// Run blocking filesystem work off the main thread.
async fn blocking<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn list_dir(path: String) -> Result<Vec<fsops::Entry>, String> {
    blocking(move || fsops::list_dir(&path)).await?
}

#[tauri::command]
async fn drives() -> Result<Vec<fsops::Drive>, String> {
    blocking(fsops::drives).await
}

#[tauri::command]
fn places() -> Vec<fsops::Place> {
    fsops::places()
}

#[tauri::command]
fn platform() -> &'static str {
    if cfg!(windows) { "windows" } else { "linux" }
}

#[tauri::command]
async fn free_space(path: String) -> Result<u64, String> {
    blocking(move || fsops::free_space(&path)).await
}

#[tauri::command]
async fn rename(path: String, name: String) -> Result<String, String> {
    blocking(move || fsops::rename(&path, &name)).await?
}

#[tauri::command]
async fn mkdir(parent: String, name: String) -> Result<String, String> {
    blocking(move || fsops::mkdir(&parent, &name)).await?
}

#[tauri::command]
async fn trash(paths: Vec<String>) -> Result<(), String> {
    blocking(move || fsops::trash(&paths)).await?
}

#[tauri::command]
async fn restore(paths: Vec<String>) -> Result<usize, String> {
    blocking(move || fsops::restore(&paths)).await?
}

#[tauri::command]
async fn delete_permanent(paths: Vec<String>) -> Result<(), String> {
    blocking(move || fsops::delete_permanent(&paths)).await?
}

#[tauri::command]
fn open_path(path: String) -> Result<(), String> {
    open::that_detached(fsops::os_path(&path)).map_err(|e| format!("Couldn't open {path}: {e}"))
}

#[tauri::command]
async fn dir_size(path: String) -> Result<fsops::DirSize, String> {
    blocking(move || fsops::dir_size(&path)).await
}

#[tauri::command]
async fn sha256(path: String) -> Result<String, String> {
    blocking(move || fsops::sha256(&path)).await?
}

#[tauri::command]
async fn duplicates(path: String) -> Result<Vec<fsops::DupGroup>, String> {
    blocking(move || fsops::duplicates(&path, 1024)).await
}

#[tauri::command]
async fn search(state: State<'_, App>, query: String, limit: Option<usize>) -> Result<index::Results, String> {
    let idx = state.index.clone();
    blocking(move || idx.search(&query, limit.unwrap_or(60))).await
}

#[tauri::command]
fn index_status(state: State<'_, App>) -> index::Status {
    state.index.status()
}

#[tauri::command]
fn reindex(state: State<'_, App>) {
    let idx = state.index.clone();
    std::thread::spawn(move || idx.rebuild());
}

#[tauri::command]
fn start_transfer(app: tauri::AppHandle, state: State<'_, App>, mode: String, sources: Vec<String>, dest: String) -> Result<u64, String> {
    state.transfers.start(app, mode, sources, dest)
}

#[tauri::command]
fn pause_transfer(state: State<'_, App>, id: u64, paused: bool) {
    state.transfers.set_paused(id, paused);
}

#[tauri::command]
fn cancel_transfer(state: State<'_, App>, id: u64) {
    state.transfers.cancel(id);
}

#[tauri::command]
fn auto_update_enabled() -> bool {
    update::auto_update_enabled()
}

#[tauri::command]
fn set_auto_update(on: bool) -> Result<(), String> {
    update::set_auto_update(on)
}

/// Called by the UI once it is listening for "update-status" events.
#[tauri::command]
fn check_updates(app: tauri::AppHandle, quiet: bool) {
    if quiet && picker_host() {
        return; // a background launch for a file dialog: don't restart under the app
    }
    tauri::async_runtime::spawn(update::run(app, quiet));
}

#[tauri::command]
async fn file_icons(keys: Vec<String>) -> Result<std::collections::HashMap<String, String>, String> {
    blocking(move || icons::icons(keys)).await
}

#[tauri::command]
async fn thumbnails(paths: Vec<String>, size: u32) -> Result<std::collections::HashMap<String, String>, String> {
    // ask in OS form, answer under the paths the UI used
    let pairs: Vec<(String, String)> = paths.into_iter().map(|p| (fsops::os_path(&p).to_string_lossy().to_string(), p)).collect();
    blocking(move || {
        let got = icons::thumbs(pairs.iter().map(|(os, _)| os.clone()).collect(), size);
        pairs.into_iter().filter_map(|(os, ui)| got.get(&os).map(|v| (ui, v.clone()))).collect()
    })
    .await
}

/// "file", "dir" or "none"
#[tauri::command]
fn path_kind(path: String) -> &'static str {
    let p = fsops::os_path(&path);
    match std::fs::metadata(p) {
        Ok(m) if m.is_dir() => "dir",
        Ok(_) => "file",
        Err(_) => "none",
    }
}

#[tauri::command]
fn picker_request(id: u64) -> Option<serde_json::Value> {
    picker::request(id)
}

#[tauri::command]
fn picker_done(window: tauri::WebviewWindow, id: u64, paths: Vec<String>, type_index: Option<u32>) {
    let paths = paths.iter().map(|p| fsops::os_path(p).to_string_lossy().to_string()).collect();
    picker::finish(id, paths, type_index);
    let _ = window.destroy();
}

#[tauri::command]
fn picker_enabled() -> bool {
    picker::enabled()
}

#[tauri::command]
async fn set_picker(app: tauri::AppHandle, enable: bool) -> Result<(), String> {
    blocking(move || picker::set_enabled(&app, enable)).await?
}

pub fn run() {
    let index = Arc::new(index::Index::default());
    let bg = index.clone();
    // Build the search index at startup, then refresh it every 10 minutes.
    std::thread::spawn(move || loop {
        bg.rebuild();
        std::thread::sleep(Duration::from_secs(600));
    });

    tauri::Builder::default()
        // A second launch (double-clicking a folder, Win+E) opens a tab in the
        // window that's already running instead of starting another copy.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if argv.iter().any(|a| a == "--picker-host") {
                return; // already running, so already serving dialogs
            }
            let path = path_from_args(argv);
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
            let _ = app.emit("open-path", path);
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(App { index, transfers: Arc::new(transfer::Transfers::default()) })
        .setup(|app| {
            if let Some(w) = app.get_webview_window("main") {
                if picker_host() {
                    let _ = w.hide();
                } else {
                    let _ = w.set_focus();
                }
            }
            #[cfg(windows)]
            {
                picker::serve(app.handle().clone());
                let h = app.handle().clone();
                std::thread::spawn(move || picker::ensure_registered(&h));
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_dir, drives, places, platform, free_space, rename, mkdir, trash, restore, delete_permanent,
            open_path, dir_size, sha256, duplicates, search, index_status, reindex, start_transfer,
            pause_transfer, cancel_transfer, startup_path, default_status, set_default,
            auto_update_enabled, set_auto_update, check_updates, file_icons, thumbnails, path_kind,
            picker_request, picker_done, picker_enabled, set_picker
        ])
        .run(tauri::generate_context!())
        .expect("error while running Slate");
}
