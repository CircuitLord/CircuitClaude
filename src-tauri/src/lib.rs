mod commands;
mod config;
mod pty_manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(pty_manager::PtyManager::new())
        .invoke_handler(tauri::generate_handler![
            commands::spawn_session,
            commands::write_session,
            commands::resize_session,
            commands::kill_session,
            commands::load_projects,
            commands::save_projects,
            commands::load_sessions_config,
            commands::save_sessions_config,
            commands::save_scrollback,
            commands::load_scrollback,
            commands::delete_scrollback,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
