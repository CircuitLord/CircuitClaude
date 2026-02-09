use crate::claude_manager::{ClaudeEvent, ClaudeManager};
use crate::config::{self, ProjectConfig, SettingsConfig};
use crate::conversation;
use crate::git;
use crate::pty_manager::{PtyManager, PtyOutputEvent};
use tauri::ipc::Channel;
use tauri::State;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const HARDCODED_SKIP: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    ".next",
    ".nuxt",
    "dist",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    "venv",
    ".venv",
    ".tox",
    "build",
    ".DS_Store",
    "Thumbs.db",
];

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileTreeEntry {
    pub name: String,
    pub path: String,
    pub full_path: String,
    pub is_dir: bool,
}

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
pub fn spawn_opencode(
    pty_manager: State<'_, PtyManager>,
    project_path: String,
    cols: u16,
    rows: u16,
    continue_session: Option<bool>,
    on_output: Channel<PtyOutputEvent>,
) -> Result<String, String> {
    pty_manager.spawn_opencode(
        &project_path,
        cols,
        rows,
        continue_session.unwrap_or(false),
        on_output,
    )
}

#[tauri::command]
pub fn spawn_codex(
    pty_manager: State<'_, PtyManager>,
    project_path: String,
    cols: u16,
    rows: u16,
    continue_session: Option<bool>,
    on_output: Channel<PtyOutputEvent>,
) -> Result<String, String> {
    pty_manager.spawn_codex(
        &project_path,
        cols,
        rows,
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
pub fn kill_session(pty_manager: State<'_, PtyManager>, session_id: String) -> Result<(), String> {
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
pub fn load_settings(app_handle: tauri::AppHandle) -> Option<SettingsConfig> {
    config::load_settings(&app_handle)
}

#[tauri::command]
pub fn save_settings(app_handle: tauri::AppHandle, settings: SettingsConfig) -> Result<(), String> {
    config::save_settings(&app_handle, &settings)
}

#[tauri::command]
pub fn get_git_status(project_path: String) -> git::GitStatus {
    git::get_status(&project_path)
}

#[tauri::command]
pub fn get_git_diff(
    project_path: String,
    file_path: String,
    status: String,
) -> Result<String, String> {
    git::get_diff(&project_path, &file_path, &status)
}

#[tauri::command]
pub fn git_commit(
    project_path: String,
    files: Vec<String>,
    message: String,
) -> Result<String, String> {
    git::commit(&project_path, &files, &message)
}

#[tauri::command]
pub fn git_revert(project_path: String, files: Vec<git::GitFileEntry>) -> Result<(), String> {
    git::revert(&project_path, &files)
}

#[tauri::command]
pub fn get_git_diff_stats(
    project_path: String,
    files: Vec<git::GitFileEntry>,
) -> Result<Vec<git::DiffStat>, String> {
    git::get_diff_stats(&project_path, &files)
}

#[tauri::command]
pub fn git_push(project_path: String) -> Result<String, String> {
    git::push(&project_path)
}

#[tauri::command]
pub fn generate_commit_message(
    project_path: String,
    files: Vec<git::GitFileEntry>,
) -> Result<git::GenerateResult, String> {
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
pub fn get_conversation_mtime(project_path: String, session_id: Option<String>) -> Option<f64> {
    conversation::get_mtime(&project_path, session_id.as_deref())
}

#[tauri::command]
pub fn load_note(app_handle: tauri::AppHandle, project_path: String) -> String {
    let notes = config::load_notes(&app_handle);
    notes.get(&project_path).cloned().unwrap_or_default()
}

#[tauri::command]
pub fn save_note(
    app_handle: tauri::AppHandle,
    project_path: String,
    content: String,
) -> Result<(), String> {
    config::save_note(&app_handle, &project_path, &content)
}

#[tauri::command]
pub fn read_claude_md(project_path: Option<String>) -> Result<ClaudeMdFile, String> {
    let path = resolve_claude_md_path(project_path)?;

    // Ensure parent directory exists and create file if missing
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    if !path.exists() {
        std::fs::write(&path, "").map_err(|e| e.to_string())?;
    }

    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    Ok(ClaudeMdFile {
        path: path.to_string_lossy().to_string(),
        content,
    })
}

#[tauri::command]
pub fn save_claude_md(project_path: Option<String>, content: String) -> Result<(), String> {
    let path = resolve_claude_md_path(project_path)?;
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

fn resolve_claude_md_path(project_path: Option<String>) -> Result<std::path::PathBuf, String> {
    if let Some(pp) = project_path {
        Ok(std::path::PathBuf::from(pp).join("CLAUDE.md"))
    } else {
        dirs::home_dir()
            .ok_or_else(|| "Could not find home directory".to_string())
            .map(|h| h.join(".claude").join("CLAUDE.md"))
    }
}

#[derive(serde::Serialize)]
pub struct ClaudeMdFile {
    pub path: String,
    pub content: String,
}

#[tauri::command]
pub fn create_claude_session(
    claude_manager: State<'_, ClaudeManager>,
    project_path: String,
    on_event: Channel<ClaudeEvent>,
) -> Result<String, String> {
    claude_manager.create_session(&project_path, on_event)
}

#[tauri::command]
pub fn send_claude_message(
    claude_manager: State<'_, ClaudeManager>,
    tab_id: String,
    message: String,
    permission_mode: Option<String>,
) -> Result<(), String> {
    claude_manager.send_message(&tab_id, &message, permission_mode.as_deref())
}

#[tauri::command]
pub fn respond_to_permission(
    claude_manager: State<'_, ClaudeManager>,
    tab_id: String,
    id: String,
    allowed: bool,
    message: Option<String>,
) -> Result<(), String> {
    claude_manager.respond_to_permission(&tab_id, &id, allowed, message)
}

#[tauri::command]
pub fn respond_to_question(
    claude_manager: State<'_, ClaudeManager>,
    tab_id: String,
    id: String,
    answers: serde_json::Value,
) -> Result<(), String> {
    claude_manager.respond_to_question(&tab_id, &id, answers)
}

#[tauri::command]
pub fn interrupt_claude_session(
    claude_manager: State<'_, ClaudeManager>,
    tab_id: String,
) -> Result<(), String> {
    claude_manager.interrupt_session(&tab_id)
}

#[tauri::command]
pub fn destroy_claude_session(
    claude_manager: State<'_, ClaudeManager>,
    tab_id: String,
) -> Result<(), String> {
    claude_manager.destroy_session(&tab_id)
}

#[tauri::command]
pub fn read_directory(
    project_path: String,
    dir_path: Option<String>,
) -> Result<Vec<FileTreeEntry>, String> {
    let base = std::path::Path::new(&project_path);
    let target = match &dir_path {
        Some(rel) => base.join(rel),
        None => base.to_path_buf(),
    };

    let entries =
        std::fs::read_dir(&target).map_err(|e| format!("Failed to read directory: {}", e))?;

    // Check if project is a git repo
    let is_git_repo = base.join(".git").exists();

    // Collect entry names for batch git check-ignore
    let mut raw_entries: Vec<(String, String, String, bool)> = Vec::new(); // (name, rel_path, full_path, is_dir)

    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();

        // Always skip .git
        if name == ".git" {
            continue;
        }

        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        let full = entry.path();
        let full_path = full.to_string_lossy().replace('\\', "/");

        // Compute relative path from project root
        let rel_path = match full.strip_prefix(base) {
            Ok(r) => r.to_string_lossy().replace('\\', "/"),
            Err(_) => full_path.clone(),
        };

        raw_entries.push((name, rel_path, full_path, is_dir));
    }

    // Filter ignored entries
    let filtered: Vec<(String, String, String, bool)> = if is_git_repo {
        // Use git check-ignore --stdin to batch-filter
        let paths_input: String = raw_entries
            .iter()
            .map(|(_, rel, _, _)| rel.as_str())
            .collect::<Vec<_>>()
            .join("\n");

        let ignored_set: std::collections::HashSet<String> = if !paths_input.is_empty() {
            let mut cmd = std::process::Command::new("git");
            cmd.args(["check-ignore", "--stdin"])
                .current_dir(&project_path)
                .stdin(std::process::Stdio::piped())
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::null());

            #[cfg(windows)]
            cmd.creation_flags(CREATE_NO_WINDOW);

            match cmd.spawn() {
                Ok(mut child) => {
                    if let Some(mut stdin) = child.stdin.take() {
                        use std::io::Write;
                        let _ = stdin.write_all(paths_input.as_bytes());
                    }
                    match child.wait_with_output() {
                        Ok(output) => {
                            String::from_utf8_lossy(&output.stdout)
                                .lines()
                                .map(|l| l.trim().to_string())
                                .collect()
                        }
                        Err(_) => std::collections::HashSet::new(),
                    }
                }
                Err(_) => std::collections::HashSet::new(),
            }
        } else {
            std::collections::HashSet::new()
        };

        raw_entries
            .into_iter()
            .filter(|(name, rel, _, _)| {
                // Always skip hardcoded entries even in git repos (e.g. node_modules might not be in .gitignore)
                if HARDCODED_SKIP.contains(&name.as_str()) {
                    return false;
                }
                !ignored_set.contains(rel)
            })
            .collect()
    } else {
        // Non-git: use hardcoded skip list
        raw_entries
            .into_iter()
            .filter(|(name, _, _, _)| !HARDCODED_SKIP.contains(&name.as_str()))
            .collect()
    };

    // Sort: dirs first, then alphabetically (case-insensitive)
    let mut dirs: Vec<_> = filtered.iter().filter(|(_, _, _, d)| *d).collect();
    let mut files: Vec<_> = filtered.iter().filter(|(_, _, _, d)| !*d).collect();
    dirs.sort_by(|a, b| a.0.to_lowercase().cmp(&b.0.to_lowercase()));
    files.sort_by(|a, b| a.0.to_lowercase().cmp(&b.0.to_lowercase()));

    let mut result: Vec<FileTreeEntry> = Vec::new();
    for (name, path, full_path, is_dir) in dirs.into_iter().chain(files.into_iter()) {
        result.push(FileTreeEntry {
            name: name.clone(),
            path: path.clone(),
            full_path: full_path.clone(),
            is_dir: *is_dir,
        });
    }

    Ok(result)
}

#[tauri::command]
pub fn exit_app(app_handle: tauri::AppHandle) {
    app_handle.exit(0);
}
