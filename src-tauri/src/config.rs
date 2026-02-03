use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectConfig {
    pub name: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedSession {
    pub id: String,
    pub project_name: String,
    pub project_path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub claude_session_id: Option<String>,
    pub created_at: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSessionLayout {
    pub project_path: String,
    pub sessions: Vec<PersistedSession>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionsConfig {
    pub layouts: Vec<ProjectSessionLayout>,
    pub active_project_path: Option<String>,
    pub active_session_id: Option<String>,
}

fn config_dir(app_handle: &tauri::AppHandle) -> PathBuf {
    let dir = app_handle
        .path()
        .app_config_dir()
        .unwrap_or_else(|_| {
            dirs::config_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join("CircuitClaude")
        });
    fs::create_dir_all(&dir).ok();
    dir
}

fn config_path(app_handle: &tauri::AppHandle) -> PathBuf {
    config_dir(app_handle).join("projects.json")
}

fn sessions_path(app_handle: &tauri::AppHandle) -> PathBuf {
    config_dir(app_handle).join("sessions.json")
}

fn scrollback_dir(app_handle: &tauri::AppHandle) -> PathBuf {
    let dir = config_dir(app_handle).join("scrollback");
    fs::create_dir_all(&dir).ok();
    dir
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

pub fn load_sessions(app_handle: &tauri::AppHandle) -> Option<SessionsConfig> {
    let path = sessions_path(app_handle);
    match fs::read_to_string(&path) {
        Ok(contents) => serde_json::from_str(&contents).ok(),
        Err(_) => None,
    }
}

pub fn save_sessions(app_handle: &tauri::AppHandle, config: &SessionsConfig) -> Result<(), String> {
    let path = sessions_path(app_handle);
    let json = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}

pub fn save_scrollback(app_handle: &tauri::AppHandle, tab_id: &str, data: &str) -> Result<(), String> {
    let path = scrollback_dir(app_handle).join(format!("{}.dat", tab_id));
    fs::write(&path, data).map_err(|e| e.to_string())
}

pub fn load_scrollback(app_handle: &tauri::AppHandle, tab_id: &str) -> Result<String, String> {
    let path = scrollback_dir(app_handle).join(format!("{}.dat", tab_id));
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

pub fn delete_scrollback(app_handle: &tauri::AppHandle, tab_id: &str) -> Result<(), String> {
    let path = scrollback_dir(app_handle).join(format!("{}.dat", tab_id));
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())
    } else {
        Ok(())
    }
}
