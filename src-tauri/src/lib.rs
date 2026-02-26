use tauri::Manager;

mod claude_manager;
mod codex_title;
mod commands;
mod config;
mod conversation;
mod git;
mod pty_manager;
mod whisper_manager;

fn resolve_bridge_path(app: &tauri::App) -> String {
    // In dev: use CARGO_MANIFEST_DIR/sidecar/claude-bridge.mjs
    if cfg!(debug_assertions) {
        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        let dev_path = std::path::Path::new(manifest_dir)
            .join("sidecar")
            .join("claude-bridge.mjs");
        return dev_path.to_string_lossy().to_string();
    }

    // In production: use Tauri resource dir
    if let Ok(resource_dir) = app.path().resource_dir() {
        let prod_path = resource_dir.join("sidecar").join("claude-bridge.mjs");
        if prod_path.exists() {
            return prod_path.to_string_lossy().to_string();
        }
    }

    // Fallback
    "claude-bridge.mjs".to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .manage(pty_manager::PtyManager::new())
        .setup(|app| {
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;

            let bridge_path = resolve_bridge_path(app);
            app.manage(claude_manager::ClaudeManager::new(bridge_path));

            // Set up whisper models directory
            let config_dir = config::config_dir(&app.handle());
            let models_dir = config_dir.join("models").join("whisper");
            std::fs::create_dir_all(&models_dir).ok();
            app.manage(whisper_manager::WhisperManager::new(models_dir));

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::create_pty_session,
            commands::attach_pty_session_stream,
            commands::detach_pty_session_stream,
            commands::write_pty_session,
            commands::resize_pty_session,
            commands::close_pty_session,
            commands::close_all_pty_sessions,
            commands::get_pty_session_info,
            commands::create_claude_session,
            commands::send_claude_message,
            commands::respond_to_permission,
            commands::respond_to_question,
            commands::interrupt_claude_session,
            commands::destroy_claude_session,
            commands::load_projects,
            commands::save_projects,
            commands::load_settings,
            commands::save_settings,
            commands::load_note,
            commands::save_note,
            commands::get_git_status,
            commands::get_git_diff,
            commands::git_commit,
            commands::git_revert,
            commands::get_git_diff_stats,
            commands::git_push,
            commands::generate_commit_message,
            commands::generate_codex_title,
            commands::read_conversation,
            commands::get_conversation_mtime,
            commands::read_claude_md,
            commands::save_claude_md,
            commands::read_agents_md,
            commands::save_agents_md,
            commands::read_directory,
            commands::save_clipboard_image,
            commands::exit_app,
            commands::whisper_start_session,
            commands::whisper_push_audio,
            commands::whisper_stop_session,
            commands::whisper_cancel_session,
            commands::whisper_load_model,
            commands::whisper_get_available_models,
            commands::whisper_download_model,
            commands::whisper_get_model_status,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                let pty_manager = app.state::<pty_manager::PtyManager>();
                pty_manager.close_all("app_exit");
                let claude_manager = app.state::<claude_manager::ClaudeManager>();
                claude_manager.destroy_all();
                let whisper_manager = app.state::<whisper_manager::WhisperManager>();
                whisper_manager.cancel_all();
                config::cleanup_old_screenshots(&app.app_handle());
            }
        });
}
