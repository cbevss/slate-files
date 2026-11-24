//! Settings that the Rust side needs (the UI keeps its own in localStorage).
//! Stored as one JSON object in <config>/slate/settings.json.

use serde_json::{Map, Value};
use std::path::PathBuf;
use std::sync::Mutex;

static LOCK: Mutex<()> = Mutex::new(());

fn path() -> Option<PathBuf> {
    dirs::config_dir().map(|d| d.join("slate").join("settings.json"))
}

fn read() -> Map<String, Value> {
    path()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default()
}

pub fn get_bool(key: &str, default: bool) -> bool {
    read().get(key).and_then(|v| v.as_bool()).unwrap_or(default)
}

pub fn set(key: &str, value: Value) -> Result<(), String> {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let p = path().ok_or("No settings folder available.")?;
    let mut m = read();
    m.insert(key.to_string(), value);
    std::fs::create_dir_all(p.parent().unwrap()).map_err(|e| e.to_string())?;
    std::fs::write(p, serde_json::to_string_pretty(&Value::Object(m)).unwrap()).map_err(|e| format!("Couldn't save settings: {e}"))
}
