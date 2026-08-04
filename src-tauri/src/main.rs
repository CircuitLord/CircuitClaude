// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if std::env::var_os("CIRCUITCLAUDE_ASKPASS").is_some() {
        if let Ok(password) = std::env::var("CIRCUITCLAUDE_SSH_PASSWORD") {
            println!("{}", password);
        }
        return;
    }
    circuitclaude_lib::run()
}
