//! Automatic updates on launch.
//!
//! Slate checks the latest GitHub release's `latest.json` (signed with the
//! project's minisign key; unsigned or tampered updates are rejected).
//! - Windows and AppImage: the Tauri updater downloads, verifies and installs,
//!   then Slate restarts.
//! - Fedora / RPM installs: the update is installed with
//!   `pkexec dnf install <rpm url>` (KDE shows its normal admin prompt), then
//!   Slate restarts.
//! - Other Linux package installs (.deb): the UI is told an update exists.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::UpdaterExt;

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
const REPO: &str = "cbevss/slate-files";

#[derive(Serialize, Deserialize)]
struct Settings {
    auto_update: bool,
}

fn settings_path() -> Option<PathBuf> {
    dirs::config_dir().map(|d| d.join("slate").join("settings.json"))
}

pub fn auto_update_enabled() -> bool {
    settings_path()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str::<Settings>(&s).ok())
        .map(|s| s.auto_update)
        .unwrap_or(true)
}

pub fn set_auto_update(on: bool) -> Result<(), String> {
    let p = settings_path().ok_or("No settings folder available.")?;
    std::fs::create_dir_all(p.parent().unwrap()).map_err(|e| e.to_string())?;
    std::fs::write(p, serde_json::to_string(&Settings { auto_update: on }).unwrap()).map_err(|e| e.to_string())
}

#[derive(Serialize, Clone)]
pub struct Status {
    pub state: &'static str, // "checking" | "current" | "downloading" | "installing" | "available" | "error"
    pub version: Option<String>,
    pub progress: Option<f64>,
    pub message: Option<String>,
}

fn emit(app: &AppHandle, s: Status) {
    let _ = app.emit("update-status", s);
}

#[cfg(target_os = "linux")]
fn installed_by_rpm() -> bool {
    std::process::Command::new("rpm").args(["-q", "slate"]).output().map(|o| o.status.success()).unwrap_or(false)
}

/// Check for an update and install it. `quiet` suppresses "you're up to date".
pub async fn run(app: AppHandle, quiet: bool) {
    let fail = |app: &AppHandle, m: String| {
        if !quiet {
            emit(app, Status { state: "error", version: None, progress: None, message: Some(m) })
        }
    };
    if !quiet {
        emit(&app, Status { state: "checking", version: None, progress: None, message: None });
    }
    let updater = match app.updater() {
        Ok(u) => u,
        Err(e) => return fail(&app, e.to_string()),
    };
    let update = match updater.check().await {
        Ok(Some(u)) => u,
        Ok(None) => {
            if !quiet {
                emit(&app, Status { state: "current", version: Some(app.package_info().version.to_string()), progress: None, message: None });
            }
            return;
        }
        Err(e) => return fail(&app, format!("Couldn't check for updates: {e}")),
    };
    let version = update.version.clone();

    #[cfg(target_os = "linux")]
    {
        if std::env::var_os("APPIMAGE").is_none() {
            if installed_by_rpm() {
                emit(&app, Status { state: "installing", version: Some(version.clone()), progress: None, message: None });
                let url = format!("https://github.com/{REPO}/releases/download/v{version}/Slate-{version}-1.x86_64.rpm");
                let ok = tauri::async_runtime::spawn_blocking(move || {
                    std::process::Command::new("pkexec").args(["dnf", "install", "-y", &url]).status().map(|s| s.success()).unwrap_or(false)
                })
                .await
                .unwrap_or(false);
                if ok {
                    app.restart();
                }
                return emit(&app, Status { state: "error", version: Some(version), progress: None, message: Some("The update wasn't installed. You can try again from Ctrl+K.".into()) });
            }
            return emit(&app, Status { state: "available", version: Some(version), progress: None, message: Some(format!("https://github.com/{REPO}/releases/latest")) });
        }
    }

    emit(&app, Status { state: "downloading", version: Some(version.clone()), progress: Some(0.0), message: None });
    let mut got: u64 = 0;
    let app2 = app.clone();
    let v2 = version.clone();
    let res = update
        .download_and_install(
            move |chunk, total| {
                got += chunk as u64;
                if let Some(t) = total {
                    emit(&app2, Status { state: "downloading", version: Some(v2.clone()), progress: Some(got as f64 / t as f64), message: None });
                }
            },
            || {},
        )
        .await;
    match res {
        Ok(()) => app.restart(),
        Err(e) => emit(&app, Status { state: "error", version: Some(version), progress: None, message: Some(format!("The update couldn't be installed: {e}")) }),
    }
}
