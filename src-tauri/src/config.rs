use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

fn default_project_theme() -> String {
    "midnight".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectConfig {
    pub name: String,
    pub path: String,
    #[serde(default = "default_project_theme")]
    pub theme: String,
}

fn config_dir(app_handle: &tauri::AppHandle) -> PathBuf {
    let dir = app_handle.path().app_config_dir().unwrap_or_else(|_| {
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

fn default_theme() -> String {
    "midnight".to_string()
}

fn default_syntax_theme() -> String {
    "github-dark".to_string()
}

fn default_font_size() -> f64 {
    15.0
}

fn default_font_family() -> String {
    "'Cascadia Code', 'Consolas', 'Monaco', monospace".to_string()
}

fn default_git_view_mode() -> String {
    "file".to_string()
}

fn default_sidebar_panel_mode() -> String {
    "source".to_string()
}

fn default_voice_mic_device_id() -> String {
    "default".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsConfig {
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_syntax_theme")]
    pub syntax_theme: String,
    #[serde(default = "default_font_size")]
    pub terminal_font_size: f64,
    #[serde(default = "default_font_family")]
    pub terminal_font_family: String,
    #[serde(default = "default_git_view_mode")]
    pub git_view_mode: String,
    #[serde(default = "default_sidebar_panel_mode")]
    pub sidebar_panel_mode: String,
    #[serde(default)]
    pub notes_panel_open: bool,
    #[serde(default = "default_voice_mic_device_id")]
    pub voice_mic_device_id: String,
}

fn settings_path(app_handle: &tauri::AppHandle) -> PathBuf {
    config_dir(app_handle).join("settings.json")
}

pub fn load_settings(app_handle: &tauri::AppHandle) -> Option<SettingsConfig> {
    let path = settings_path(app_handle);
    match fs::read_to_string(&path) {
        Ok(contents) => serde_json::from_str(&contents).ok(),
        Err(_) => None,
    }
}

pub fn save_settings(
    app_handle: &tauri::AppHandle,
    settings: &SettingsConfig,
) -> Result<(), String> {
    let path = settings_path(app_handle);
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}
