mod fsops;
mod index;
mod transfer;

use std::sync::Arc;
use std::time::Duration;
use tauri::{Manager, State};

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

pub fn run() {
    let index = Arc::new(index::Index::default());
    let bg = index.clone();
    // Build the search index at startup, then refresh it every 10 minutes.
    std::thread::spawn(move || loop {
        bg.rebuild();
        std::thread::sleep(Duration::from_secs(600));
    });

    tauri::Builder::default()
        .manage(App { index, transfers: Arc::new(transfer::Transfers::default()) })
        .setup(|app| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_focus();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_dir, drives, places, platform, free_space, rename, mkdir, trash, restore, delete_permanent,
            open_path, dir_size, sha256, duplicates, search, index_status, reindex, start_transfer,
            pause_transfer, cancel_transfer
        ])
        .run(tauri::generate_context!())
        .expect("error while running Slate");
}
