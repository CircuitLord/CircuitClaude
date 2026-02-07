use tauri::Manager;

mod claude_manager;
mod commands;
mod config;
mod conversation;
mod git;
mod pty_manager;

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
        .manage(pty_manager::PtyManager::new())
        .setup(|app| {
            let bridge_path = resolve_bridge_path(app);
            app.manage(claude_manager::ClaudeManager::new(bridge_path));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::spawn_session,
            commands::spawn_shell,
            commands::write_session,
            commands::resize_session,
            commands::kill_session,
            commands::kill_all_sessions,
            commands::create_claude_session,
            commands::send_claude_message,
            commands::respond_to_permission,
            commands::respond_to_question,
            commands::interrupt_claude_session,
            commands::destroy_claude_session,
            commands::load_projects,
            commands::save_projects,
            commands::load_sessions_config,
            commands::save_sessions_config,
            commands::load_settings,
            commands::save_settings,
            commands::save_scrollback,
            commands::load_scrollback,
            commands::delete_scrollback,
            commands::get_git_status,
            commands::get_git_diff,
            commands::git_commit,
            commands::git_revert,
            commands::get_git_diff_stats,
            commands::git_push,
            commands::generate_commit_message,
            commands::read_conversation,
            commands::get_conversation_mtime,
            commands::read_claude_md,
            commands::save_claude_md,
            commands::exit_app,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                let pty_manager = app.state::<pty_manager::PtyManager>();
                pty_manager.kill_all();
                let claude_manager = app.state::<claude_manager::ClaudeManager>();
                claude_manager.destroy_all();
            }
        });
}
