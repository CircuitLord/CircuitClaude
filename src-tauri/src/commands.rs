use crate::config::{self, ProjectConfig, SessionsConfig, SettingsConfig};
use crate::conversation;
use crate::git;
use crate::pty_manager::{PtyManager, PtyOutputEvent};
use tauri::ipc::Channel;
use tauri::State;

#[tauri::command]
pub fn spawn_session(
    pty_manager: State<'_, PtyManager>,
    project_path: String,
    cols: u16,
    rows: u16,
    claude_session_id: Option<String>,
    resume_session_id: Option<String>,
    continue_session: Option<bool>,
    on_output: Channel<PtyOutputEvent>,
) -> Result<String, String> {
    pty_manager.spawn(
        &project_path,
        cols,
        rows,
        claude_session_id,
        resume_session_id,
        continue_session.unwrap_or(false),
        on_output,
    )
}

#[tauri::command]
pub fn spawn_shell(
    pty_manager: State<'_, PtyManager>,
    project_path: String,
    cols: u16,
    rows: u16,
    on_output: Channel<PtyOutputEvent>,
) -> Result<String, String> {
    pty_manager.spawn_shell(&project_path, cols, rows, on_output)
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
pub fn kill_all_sessions(pty_manager: State<'_, PtyManager>) -> Result<(), String> {
    pty_manager.kill_all();
    Ok(())
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

#[tauri::command]
pub fn load_sessions_config(app_handle: tauri::AppHandle) -> Option<SessionsConfig> {
    config::load_sessions(&app_handle)
}

#[tauri::command]
pub fn save_sessions_config(
    app_handle: tauri::AppHandle,
    config: SessionsConfig,
) -> Result<(), String> {
    config::save_sessions(&app_handle, &config)
}

#[tauri::command]
pub fn save_scrollback(
    app_handle: tauri::AppHandle,
    tab_id: String,
    data: String,
) -> Result<(), String> {
    config::save_scrollback(&app_handle, &tab_id, &data)
}

#[tauri::command]
pub fn load_scrollback(
    app_handle: tauri::AppHandle,
    tab_id: String,
) -> Result<String, String> {
    config::load_scrollback(&app_handle, &tab_id)
}

#[tauri::command]
pub fn delete_scrollback(
    app_handle: tauri::AppHandle,
    tab_id: String,
) -> Result<(), String> {
    config::delete_scrollback(&app_handle, &tab_id)
}

#[tauri::command]
pub fn load_settings(app_handle: tauri::AppHandle) -> Option<SettingsConfig> {
    config::load_settings(&app_handle)
}

#[tauri::command]
pub fn save_settings(
    app_handle: tauri::AppHandle,
    settings: SettingsConfig,
) -> Result<(), String> {
    config::save_settings(&app_handle, &settings)
}

#[tauri::command]
pub fn get_git_status(project_path: String) -> git::GitStatus {
    git::get_status(&project_path)
}

#[tauri::command]
pub fn get_git_diff(project_path: String, file_path: String, staged: bool, status: String) -> Result<String, String> {
    git::get_diff(&project_path, &file_path, staged, &status)
}

#[tauri::command]
pub fn git_commit(project_path: String, files: Vec<String>, message: String) -> Result<String, String> {
    git::commit(&project_path, &files, &message)
}

#[tauri::command]
pub fn git_revert(project_path: String, files: Vec<git::GitFileEntry>) -> Result<(), String> {
    git::revert(&project_path, &files)
}

#[tauri::command]
pub fn get_git_diff_stats(project_path: String, files: Vec<git::GitFileEntry>) -> Result<Vec<git::DiffStat>, String> {
    git::get_diff_stats(&project_path, &files)
}

#[tauri::command]
pub fn git_push(project_path: String) -> Result<String, String> {
    git::push(&project_path)
}

#[tauri::command]
pub fn generate_commit_message(project_path: String, files: Vec<git::GitFileEntry>) -> Result<git::GenerateResult, String> {
    git::generate_commit_message(&project_path, &files)
}

#[tauri::command]
pub fn read_conversation(
    project_path: String,
    session_id: Option<String>,
) -> Result<conversation::ConversationResponse, String> {
    conversation::read_conversation(&project_path, session_id.as_deref())
        .ok_or_else(|| "No conversation file found".to_string())
}

#[tauri::command]
pub fn get_conversation_mtime(
    project_path: String,
    session_id: Option<String>,
) -> Option<f64> {
    conversation::get_mtime(&project_path, session_id.as_deref())
}

#[tauri::command]
pub fn exit_app(app_handle: tauri::AppHandle) {
    app_handle.exit(0);
}
