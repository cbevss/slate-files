//! Make Slate the default file explorer for the current user, and undo it.
//!
//! Windows: per-user registry keys under HKCU\Software\Classes. Folders and
//! drives get a default "slate" verb, and Win+E (the "This PC" shell folder's
//! open-new-window verb) launches Slate. Explorer itself is untouched;
//! restoring deletes exactly these keys.
//!
//! Linux: sets the inode/directory handler with xdg-mime (what KDE's "Default
//! Applications > File Manager" changes), remembering the previous handler.

#[cfg(windows)]
mod imp {
    use winreg::enums::*;
    use winreg::RegKey;

    const THIS_PC: &str = r"Software\Classes\CLSID\{52205fd8-5dfb-447d-801a-d0b52f2e83e1}";

    fn exe() -> Result<String, String> {
        std::env::current_exe().map(|p| p.to_string_lossy().to_string()).map_err(|e| e.to_string())
    }

    pub fn is_default() -> bool {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        hkcu.open_subkey(r"Software\Classes\Directory\shell")
            .and_then(|k| k.get_value::<String, _>(""))
            .map(|v| v == "slate")
            .unwrap_or(false)
    }

    pub fn set(enable: bool) -> Result<(), String> {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let e = |x: std::io::Error| format!("Couldn't update the registry: {x}");
        if enable {
            let exe = exe()?;
            for class in ["Directory", "Drive"] {
                let (shell, _) = hkcu.create_subkey(format!(r"Software\Classes\{class}\shell")).map_err(e)?;
                shell.set_value("", &"slate").map_err(e)?;
                let (verb, _) = shell.create_subkey("slate").map_err(e)?;
                verb.set_value("", &"Open in Slate").map_err(e)?;
                verb.set_value("Icon", &format!("\"{exe}\",0")).map_err(e)?;
                let (cmd, _) = verb.create_subkey("command").map_err(e)?;
                cmd.set_value("", &format!("\"{exe}\" \"%1\"")).map_err(e)?;
            }
            let (cmd, _) = hkcu.create_subkey(format!(r"{THIS_PC}\shell\opennewwindow\command")).map_err(e)?;
            cmd.set_value("", &format!("\"{exe}\"")).map_err(e)?;
            cmd.set_value("DelegateExecute", &"").map_err(e)?;
        } else {
            for class in ["Directory", "Drive"] {
                if let Ok(shell) = hkcu.open_subkey_with_flags(format!(r"Software\Classes\{class}\shell"), KEY_ALL_ACCESS) {
                    if shell.get_value::<String, _>("").map(|v| v == "slate").unwrap_or(false) {
                        let _ = shell.delete_value("");
                    }
                    let _ = shell.delete_subkey_all("slate");
                }
            }
            let _ = hkcu.delete_subkey_all(THIS_PC);
        }
        notify_shell();
        Ok(())
    }

    // Tell Explorer that file associations changed so it picks this up now.
    fn notify_shell() {
        #[link(name = "shell32")]
        extern "system" {
            fn SHChangeNotify(event: i32, flags: u32, a: *const core::ffi::c_void, b: *const core::ffi::c_void);
        }
        const SHCNE_ASSOCCHANGED: i32 = 0x0800_0000;
        unsafe { SHChangeNotify(SHCNE_ASSOCCHANGED, 0, std::ptr::null(), std::ptr::null()) };
    }
}

#[cfg(not(windows))]
mod imp {
    use std::process::Command;

    fn query() -> String {
        Command::new("xdg-mime").args(["query", "default", "inode/directory"]).output()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .unwrap_or_default()
    }

    fn our_desktop_file() -> Option<String> {
        for dir in ["/usr/share/applications", "/usr/local/share/applications"] {
            if let Ok(rd) = std::fs::read_dir(dir) {
                for e in rd.flatten() {
                    let n = e.file_name().to_string_lossy().to_string();
                    if n.ends_with(".desktop") && n.to_lowercase().contains("slate") {
                        return Some(n);
                    }
                }
            }
        }
        None
    }

    fn memo() -> Option<std::path::PathBuf> {
        dirs::config_dir().map(|d| d.join("slate").join("previous-file-manager"))
    }

    pub fn is_default() -> bool {
        query().to_lowercase().contains("slate")
    }

    pub fn set(enable: bool) -> Result<(), String> {
        let target = if enable {
            let ours = our_desktop_file().ok_or("Slate's launcher entry wasn't found. Install Slate from the .rpm or .deb package first.")?;
            let prev = query();
            if !prev.to_lowercase().contains("slate") {
                if let Some(m) = memo() {
                    let _ = std::fs::create_dir_all(m.parent().unwrap());
                    let _ = std::fs::write(m, &prev);
                }
            }
            ours
        } else {
            memo().and_then(|m| std::fs::read_to_string(m).ok()).filter(|s| !s.trim().is_empty())
                .unwrap_or_else(|| "org.kde.dolphin.desktop".into())
        };
        let ok = Command::new("xdg-mime").args(["default", target.trim(), "inode/directory"]).status()
            .map_err(|e| format!("Couldn't run xdg-mime: {e}"))?.success();
        if ok { Ok(()) } else { Err("xdg-mime couldn't change the default file manager.".into()) }
    }
}

pub use imp::{is_default, set};
