use crate::claude_manager::{ClaudeEvent, ClaudeManager};
use crate::claude_title;
use crate::codex_title;
use crate::config::{self, ProjectConfig, SettingsConfig};
use crate::conversation;
use crate::git;
use crate::pty_manager::{AttachStreamResult, PtyManager, PtyOutputEvent, PtySessionInfo};
use crate::file_watcher::FileWatcherManager;
use crate::whisper_manager::{DownloadProgress, ModelInfo, WhisperEvent, WhisperManager};
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

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatePtySessionRequest {
    pub project_path: String,
    pub cols: u16,
    pub rows: u16,
    pub session_type: String,
    pub claude_session_id: Option<String>,
    pub resume_session_id: Option<String>,
    pub continue_session: Option<bool>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatePtySessionResponse {
    pub session_id: String,
}

#[tauri::command]
pub fn create_pty_session(
    pty_manager: State<'_, PtyManager>,
    request: CreatePtySessionRequest,
) -> Result<CreatePtySessionResponse, String> {
    let session_id = pty_manager.create_session(
        &request.project_path,
        request.cols,
        request.rows,
        &request.session_type,
        request.claude_session_id,
        request.resume_session_id,
        request.continue_session.unwrap_or(false),
    )?;
    Ok(CreatePtySessionResponse { session_id })
}

#[tauri::command]
pub fn attach_pty_session_stream(
    pty_manager: State<'_, PtyManager>,
    session_id: String,
    replay_from_seq: Option<u64>,
    on_output: Channel<PtyOutputEvent>,
) -> Result<AttachStreamResult, String> {
    pty_manager.attach_stream(&session_id, replay_from_seq, on_output)
}

#[tauri::command]
pub fn detach_pty_session_stream(
    pty_manager: State<'_, PtyManager>,
    session_id: String,
    subscriber_id: String,
) -> Result<(), String> {
    pty_manager.detach_stream(&session_id, &subscriber_id)
}

#[tauri::command]
pub fn write_pty_session(
    pty_manager: State<'_, PtyManager>,
    session_id: String,
    data: Vec<u8>,
) -> Result<(), String> {
    pty_manager.write(&session_id, &data)
}

#[tauri::command]
pub fn resize_pty_session(
    pty_manager: State<'_, PtyManager>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    pty_manager.resize(&session_id, cols, rows)
}

#[tauri::command]
pub fn close_pty_session(
    pty_manager: State<'_, PtyManager>,
    session_id: String,
) -> Result<(), String> {
    pty_manager.close_session(&session_id, "closed_by_client")
}

#[tauri::command]
pub fn close_all_pty_sessions(pty_manager: State<'_, PtyManager>) -> Result<(), String> {
    pty_manager.close_all("closed_all_by_client");
    Ok(())
}

#[tauri::command]
pub fn get_pty_session_info(
    pty_manager: State<'_, PtyManager>,
    session_id: String,
) -> Result<PtySessionInfo, String> {
    pty_manager.get_info(&session_id)
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
pub async fn generate_commit_message(
    project_path: String,
    files: Vec<git::GitFileEntry>,
) -> Result<git::GenerateResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        git::generate_commit_message(&project_path, &files)
    })
    .await
    .map_err(|e| format!("Task join failed: {}", e))?
}

#[tauri::command]
pub async fn generate_codex_title(
    project_path: String,
    spawned_at_ms: f64,
    max_chars: Option<u32>,
    prompt_limit: Option<u32>,
    context_char_budget: Option<u32>,
) -> Result<String, String> {
    let max_chars = max_chars.unwrap_or(40) as usize;
    let prompt_limit = prompt_limit.unwrap_or(3) as usize;
    let context_char_budget = context_char_budget.unwrap_or(400) as usize;

    tauri::async_runtime::spawn_blocking(move || {
        codex_title::generate_codex_title(
            &project_path,
            spawned_at_ms,
            max_chars,
            prompt_limit,
            context_char_budget,
        )
    })
    .await
    .map_err(|e| format!("Codex title task join failed: {}", e))?
}

#[tauri::command]
pub async fn generate_claude_title(
    project_path: String,
    spawned_at_ms: f64,
    max_chars: Option<u32>,
    prompt_limit: Option<u32>,
    context_char_budget: Option<u32>,
) -> Result<String, String> {
    let max_chars = max_chars.unwrap_or(40) as usize;
    let prompt_limit = prompt_limit.unwrap_or(3) as usize;
    let context_char_budget = context_char_budget.unwrap_or(400) as usize;

    tauri::async_runtime::spawn_blocking(move || {
        claude_title::generate_claude_title(
            &project_path,
            spawned_at_ms,
            max_chars,
            prompt_limit,
            context_char_budget,
        )
    })
    .await
    .map_err(|e| format!("Claude title task join failed: {}", e))?
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
pub fn load_note(project_path: String) -> String {
    let path = std::path::Path::new(&project_path).join("notes.md");
    std::fs::read_to_string(&path).unwrap_or_default()
}

#[tauri::command]
pub fn save_note(project_path: String, content: String) -> Result<(), String> {
    let path = std::path::Path::new(&project_path).join("notes.md");
    std::fs::write(&path, &content).map_err(|e| e.to_string())
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

fn resolve_claude_md_path(project_path: Option<String>) -> Result<std::path::PathBuf, String> {
    if let Some(pp) = project_path {
        Ok(std::path::PathBuf::from(pp).join("CLAUDE.md"))
    } else {
        dirs::home_dir()
            .ok_or_else(|| "Could not find home directory".to_string())
            .map(|h| h.join(".claude").join("CLAUDE.md"))
    }
}

#[tauri::command]
pub fn read_agents_md(project_path: Option<String>) -> Result<ClaudeMdFile, String> {
    let path = resolve_agents_md_path(project_path)?;

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

fn resolve_agents_md_path(project_path: Option<String>) -> Result<std::path::PathBuf, String> {
    if let Some(pp) = project_path {
        Ok(std::path::PathBuf::from(pp).join("agents.md"))
    } else {
        dirs::home_dir()
            .ok_or_else(|| "Could not find home directory".to_string())
            .map(|h| h.join(".claude").join("agents.md"))
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
                        Ok(output) => String::from_utf8_lossy(&output.stdout)
                            .lines()
                            .map(|l| l.trim().to_string())
                            .collect(),
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
pub fn scan_project_files(project_path: String) -> Result<Vec<String>, String> {
    use ignore::WalkBuilder;

    let base = std::path::Path::new(&project_path);
    if !base.is_dir() {
        return Err(format!("Not a directory: {}", project_path));
    }

    let walker = WalkBuilder::new(base)
        .hidden(true) // skip hidden files/dirs
        .git_ignore(true) // respect .gitignore
        .git_global(true)
        .git_exclude(true)
        .build();

    let mut files: Vec<String> = Vec::new();
    let cap = 10_000usize;

    for entry in walker {
        if files.len() >= cap {
            break;
        }
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };

        // Skip directories
        if entry.file_type().map(|ft| ft.is_dir()).unwrap_or(true) {
            continue;
        }

        let path = entry.path();

        // Hardcoded skip for dirs that might not be in .gitignore
        if path.ancestors().any(|a| {
            a.file_name()
                .map(|n| HARDCODED_SKIP.contains(&n.to_string_lossy().as_ref()))
                .unwrap_or(false)
        }) {
            continue;
        }

        if let Ok(rel) = path.strip_prefix(base) {
            files.push(rel.to_string_lossy().replace('\\', "/"));
        }
    }

    files.sort_unstable();
    Ok(files)
}

#[tauri::command]
pub fn read_file(file_path: String) -> Result<String, String> {
    std::fs::read_to_string(&file_path).map_err(|e| format!("Failed to read file: {}", e))
}

#[tauri::command]
pub fn write_file(file_path: String, content: String) -> Result<(), String> {
    std::fs::write(&file_path, &content).map_err(|e| format!("Failed to write file: {}", e))
}

#[tauri::command]
pub fn save_clipboard_image(
    app_handle: tauri::AppHandle,
    data: Vec<u8>,
    mime_type: String,
) -> Result<String, String> {
    let ext = match mime_type.as_str() {
        "image/png" => "png",
        "image/jpeg" | "image/jpg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/bmp" => "bmp",
        _ => "png",
    };

    let dir = config::screenshots_dir(&app_handle);
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create screenshots dir: {}", e))?;

    let now = chrono::Local::now();
    let base_name = now.format("screenshot_%Y-%m-%d_%H%M%S").to_string();
    let mut path = dir.join(format!("{}.{}", base_name, ext));

    if path.exists() {
        let suffix = uuid::Uuid::new_v4().to_string();
        let short = &suffix[..8];
        path = dir.join(format!("{}_{}.{}", base_name, short, ext));
    }

    std::fs::write(&path, &data).map_err(|e| format!("Failed to write screenshot: {}", e))?;

    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn exit_app(app_handle: tauri::AppHandle) {
    app_handle.exit(0);
}

// --- File watcher commands ---

#[tauri::command]
pub fn watch_file(
    file_watcher: State<'_, FileWatcherManager>,
    tab_id: String,
    file_path: String,
) -> Result<(), String> {
    file_watcher.watch_file(&tab_id, &file_path)
}

#[tauri::command]
pub fn unwatch_file(
    file_watcher: State<'_, FileWatcherManager>,
    tab_id: String,
    file_path: String,
) -> Result<(), String> {
    file_watcher.unwatch_file(&tab_id, &file_path)
}

// --- Whisper STT commands ---
// start_session, stop_session, load_model, and download_model are async because
// they can block for seconds (model loading, inference, HTTP download).
// push_audio stays synchronous — it just appends to a buffer and is called ~4x/sec.

#[tauri::command]
pub async fn whisper_start_session(
    whisper_manager: State<'_, WhisperManager>,
    session_id: String,
    model_name: String,
    on_event: Channel<WhisperEvent>,
) -> Result<(), String> {
    let wm = whisper_manager.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        wm.start_session(&session_id, &model_name, on_event)
    })
    .await
    .map_err(|e| format!("Task join failed: {}", e))?
}

#[tauri::command]
pub fn whisper_push_audio(
    whisper_manager: State<'_, WhisperManager>,
    session_id: String,
    samples: Vec<f32>,
) -> Result<(), String> {
    whisper_manager.push_audio(&session_id, samples)
}

#[tauri::command]
pub async fn whisper_stop_session(
    whisper_manager: State<'_, WhisperManager>,
    session_id: String,
) -> Result<String, String> {
    let wm = whisper_manager.inner().clone();
    tauri::async_runtime::spawn_blocking(move || wm.stop_session(&session_id))
        .await
        .map_err(|e| format!("Task join failed: {}", e))?
}

#[tauri::command]
pub fn whisper_cancel_session(
    whisper_manager: State<'_, WhisperManager>,
    session_id: String,
) -> Result<(), String> {
    whisper_manager.cancel_session(&session_id);
    Ok(())
}

#[tauri::command]
pub async fn whisper_load_model(
    whisper_manager: State<'_, WhisperManager>,
    model_name: String,
) -> Result<(), String> {
    let wm = whisper_manager.inner().clone();
    tauri::async_runtime::spawn_blocking(move || wm.load_model(&model_name))
        .await
        .map_err(|e| format!("Task join failed: {}", e))?
}

#[tauri::command]
pub fn whisper_get_available_models(
    whisper_manager: State<'_, WhisperManager>,
) -> Vec<ModelInfo> {
    whisper_manager.get_available_models()
}

#[tauri::command]
pub async fn whisper_download_model(
    whisper_manager: State<'_, WhisperManager>,
    model_name: String,
    on_progress: Channel<DownloadProgress>,
) -> Result<(), String> {
    let wm = whisper_manager.inner().clone();
    tauri::async_runtime::spawn_blocking(move || wm.download_model(&model_name, on_progress))
        .await
        .map_err(|e| format!("Task join failed: {}", e))?
}

#[tauri::command]
pub fn whisper_get_model_status(
    whisper_manager: State<'_, WhisperManager>,
    model_name: String,
) -> ModelInfo {
    whisper_manager.get_model_status(&model_name)
}

// --- Everything search ---

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EverythingResult {
    pub path: String,
    pub filename: String,
    pub dir: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EverythingResponse {
    pub results: Vec<EverythingResult>,
    pub available: bool,
    pub error: Option<String>,
    /// "not_installed" | "not_running" | "es_error" | null
    pub error_kind: Option<String>,
}

fn es_exe_config_path() -> std::path::PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("CircuitClaude")
        .join("bin")
        .join("es.exe")
}

fn find_es_exe() -> Option<String> {
    // Check app config dir first (downloaded by us)
    let config_path = es_exe_config_path();
    if config_path.exists() {
        return Some(config_path.to_string_lossy().to_string());
    }

    // Try PATH via `where es`
    let mut cmd = std::process::Command::new("where");
    cmd.arg("es")
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null());
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    if let Ok(output) = cmd.output() {
        if output.status.success() {
            if let Some(line) = String::from_utf8_lossy(&output.stdout).lines().next() {
                let trimmed = line.trim();
                if !trimmed.is_empty() {
                    return Some(trimmed.to_string());
                }
            }
        }
    }

    // Fallback paths
    let fallbacks = [
        r"C:\Program Files\Everything\es.exe",
        r"C:\Program Files (x86)\Everything\es.exe",
        r"C:\Program Files\Everything 1.5a\es.exe",
    ];
    for path in &fallbacks {
        if std::path::Path::new(path).exists() {
            return Some(path.to_string());
        }
    }

    None
}

#[tauri::command]
pub async fn search_everything(
    query: String,
    max_results: Option<u32>,
) -> Result<EverythingResponse, String> {
    let max = max_results.unwrap_or(50);

    tauri::async_runtime::spawn_blocking(move || {
        let es_path = match find_es_exe() {
            Some(p) => p,
            None => {
                return Ok(EverythingResponse {
                    results: vec![],
                    available: false,
                    error: Some("es.exe not found".into()),
                    error_kind: Some("not_installed".into()),
                });
            }
        };

        let mut cmd = std::process::Command::new(&es_path);
        cmd.args(["-sort", "dm", "-max-results", &max.to_string(), &query])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);

        let output = match cmd.output() {
            Ok(o) => o,
            Err(e) => {
                return Ok(EverythingResponse {
                    results: vec![],
                    available: false,
                    error: Some(format!("failed to run es.exe: {}", e)),
                    error_kind: Some("not_installed".into()),
                });
            }
        };

        if !output.status.success() {
            let exit_code = output.status.code().unwrap_or(-1);
            // Exit code 8 = Everything IPC window not found (not running)
            if exit_code == 8 {
                return Ok(EverythingResponse {
                    results: vec![],
                    available: false,
                    error: Some("Everything is not running".into()),
                    error_kind: Some("not_running".into()),
                });
            }
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            return Ok(EverythingResponse {
                results: vec![],
                available: true,
                error: Some(if stderr.trim().is_empty() {
                    format!("es.exe error (exit code {})", exit_code)
                } else {
                    stderr
                }),
                error_kind: Some("es_error".into()),
            });
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let results: Vec<EverythingResult> = stdout
            .lines()
            .filter(|line| !line.trim().is_empty())
            .map(|line| {
                let normalized = line.trim().replace('\\', "/");
                let path = std::path::Path::new(&normalized);
                let filename = path
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default();
                let dir = path
                    .parent()
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_default();
                EverythingResult {
                    path: normalized,
                    filename,
                    dir,
                }
            })
            .collect();

        Ok(EverythingResponse {
            results,
            available: true,
            error: None,
            error_kind: None,
        })
    })
    .await
    .map_err(|e| format!("Task join failed: {}", e))?
}

const ES_EXE_URL: &str = "https://www.voidtools.com/ES-1.1.0.30.x64.zip";

#[tauri::command]
pub async fn download_es_exe() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let dest = es_exe_config_path();
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("failed to create bin dir: {}", e))?;
        }

        let client = reqwest::blocking::Client::new();
        let response = client
            .get(ES_EXE_URL)
            .send()
            .map_err(|e| format!("download failed: {}", e))?;

        if !response.status().is_success() {
            return Err(format!("download failed: HTTP {}", response.status()));
        }

        let bytes = response
            .bytes()
            .map_err(|e| format!("failed to read response: {}", e))?;

        // Extract es.exe from the zip
        let cursor = std::io::Cursor::new(&bytes);
        let mut archive =
            zip::ZipArchive::new(cursor).map_err(|e| format!("failed to open zip: {}", e))?;

        for i in 0..archive.len() {
            let mut file = archive
                .by_index(i)
                .map_err(|e| format!("failed to read zip entry: {}", e))?;
            let name = file.name().to_lowercase();
            if name == "es.exe" || name.ends_with("/es.exe") {
                let mut out = std::fs::File::create(&dest)
                    .map_err(|e| format!("failed to create es.exe: {}", e))?;
                std::io::copy(&mut file, &mut out)
                    .map_err(|e| format!("failed to write es.exe: {}", e))?;
                return Ok(dest.to_string_lossy().to_string());
            }
        }

        Err("es.exe not found in downloaded zip".into())
    })
    .await
    .map_err(|e| format!("Task join failed: {}", e))?
}
