use crate::config::{self, ProjectConfig};
use crate::pty_manager::{PtyManager, PtyOutputEvent};
use tauri::ipc::Channel;
use tauri::State;

#[tauri::command]
pub fn spawn_session(
    pty_manager: State<'_, PtyManager>,
    project_path: String,
    cols: u16,
    rows: u16,
    on_output: Channel<PtyOutputEvent>,
) -> Result<String, String> {
    pty_manager.spawn(&project_path, cols, rows, on_output)
}

#[tauri::command]
pub fn write_session(
    pty_manager: State<'_, PtyManager>,
    session_id: String,
    data: Vec<u8>,
) -> Result<(), String> {
    pty_manager.write(&session_id, &data)
}

#[tauri::command]
pub fn resize_session(
    pty_manager: State<'_, PtyManager>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    pty_manager.resize(&session_id, cols, rows)
}

#[tauri::command]
pub fn kill_session(
    pty_manager: State<'_, PtyManager>,
    session_id: String,
) -> Result<(), String> {
    pty_manager.kill(&session_id)
}

#[tauri::command]
pub fn load_projects(app_handle: tauri::AppHandle) -> Vec<ProjectConfig> {
    config::load(&app_handle)
}

#[tauri::command]
pub fn save_projects(
    app_handle: tauri::AppHandle,
    projects: Vec<ProjectConfig>,
) -> Result<(), String> {
    config::save(&app_handle, &projects)
}
