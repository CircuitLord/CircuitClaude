use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectConfig {
    pub name: String,
    pub path: String,
}

fn config_path(app_handle: &tauri::AppHandle) -> PathBuf {
    let config_dir = app_handle
        .path()
        .app_config_dir()
        .unwrap_or_else(|_| {
            dirs::config_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join("CircuitClaude")
        });
    fs::create_dir_all(&config_dir).ok();
    config_dir.join("projects.json")
}

pub fn load(app_handle: &tauri::AppHandle) -> Vec<ProjectConfig> {
    let path = config_path(app_handle);
    match fs::read_to_string(&path) {
        Ok(contents) => serde_json::from_str(&contents).unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

pub fn save(app_handle: &tauri::AppHandle, projects: &[ProjectConfig]) -> Result<(), String> {
    let path = config_path(app_handle);
    let json = serde_json::to_string_pretty(projects).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}
