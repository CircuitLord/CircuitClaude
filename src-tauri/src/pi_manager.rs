use serde::Serialize;
use serde_json::json;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;

#[derive(Debug, Clone, Serialize)]
#[serde(transparent)]
pub struct PiRpcEvent(pub serde_json::Value);

#[derive(Serialize)]
#[serde(tag = "type")]
enum PiCommand {
    #[serde(rename = "prompt")]
    Prompt { message: String },
    #[serde(rename = "abort")]
    Abort,
}

struct PiSession {
    child: Option<Child>,
    stdin: Option<std::process::ChildStdin>,
}

impl PiSession {
    fn write_command(&mut self, cmd: &PiCommand) -> Result<(), String> {
        let stdin = self.stdin.as_mut().ok_or("pi stdin not available")?;
        let json = serde_json::to_string(cmd).map_err(|e| e.to_string())?;
        stdin
            .write_all(json.as_bytes())
            .map_err(|e| format!("Write to pi stdin failed: {}", e))?;
        stdin
            .write_all(b"\n")
            .map_err(|e| format!("Write newline failed: {}", e))?;
        stdin.flush().map_err(|e| format!("Flush failed: {}", e))?;
        Ok(())
    }
}

pub struct PiManager {
    sessions: Arc<Mutex<HashMap<String, PiSession>>>,
}

#[cfg(target_os = "windows")]
fn build_pi_command() -> Result<Command, String> {
    let node = resolve_node_exe().ok_or_else(|| {
        "Could not find node.exe. Install Node.js or add it to the system PATH.".to_string()
    })?;
    let cli = resolve_pi_cli().ok_or_else(|| {
        "Could not find pi CLI. Expected npm global @earendil-works/pi-coding-agent.".to_string()
    })?;

    let mut cmd = Command::new(node);
    cmd.arg(cli);
    Ok(cmd)
}

#[cfg(not(target_os = "windows"))]
fn build_pi_command() -> Result<Command, String> {
    Ok(Command::new("pi"))
}

#[cfg(target_os = "windows")]
fn resolve_node_exe() -> Option<std::path::PathBuf> {
    let mut candidates = Vec::new();

    if let Some(program_files) = std::env::var_os("ProgramFiles") {
        candidates.push(std::path::PathBuf::from(program_files).join("nodejs").join("node.exe"));
    }
    if let Some(program_files_x86) = std::env::var_os("ProgramFiles(x86)") {
        candidates.push(std::path::PathBuf::from(program_files_x86).join("nodejs").join("node.exe"));
    }
    if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
        candidates.push(std::path::PathBuf::from(local_app_data).join("Programs").join("nodejs").join("node.exe"));
    }

    if let Some(path) = std::env::var_os("PATH").or_else(|| std::env::var_os("Path")) {
        candidates.extend(std::env::split_paths(&path).map(|entry| entry.join("node.exe")));
    }

    candidates.into_iter().find(|path| path.exists())
}

#[cfg(target_os = "windows")]
fn resolve_pi_cli() -> Option<std::path::PathBuf> {
    let mut candidates = Vec::new();

    if let Some(app_data) = std::env::var_os("APPDATA") {
        candidates.push(std::path::PathBuf::from(app_data).join("npm"));
    }
    if let Some(home) = dirs::home_dir() {
        candidates.push(home.join("AppData").join("Roaming").join("npm"));
    }

    candidates
        .into_iter()
        .map(|npm_dir| npm_dir.join("node_modules").join("@earendil-works").join("pi-coding-agent").join("dist").join("cli.js"))
        .find(|path| path.exists())
}

fn terminate_child(child: &mut Child) {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let _ = Command::new("taskkill")
            .args(["/F", "/T", "/PID", &child.id().to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .status();
    }

    let _ = child.kill();
    let _ = child.wait();
}

impl PiManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn create_session(
        &self,
        project_path: &str,
        on_event: Channel<PiRpcEvent>,
    ) -> Result<String, String> {
        let session_id = uuid::Uuid::new_v4().to_string();

        let mut cmd = build_pi_command()?;
        cmd.arg("--mode").arg("rpc").arg("--no-session");
        cmd.current_dir(project_path);
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());
        cmd.stdin(Stdio::piped());

        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000);
        }

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to spawn pi --mode rpc: {}", e))?;

        let stdin = child.stdin.take().ok_or("Failed to capture pi stdin")?;
        let stdout = child.stdout.take().ok_or("Failed to capture pi stdout")?;
        let stderr = child.stderr.take().ok_or("Failed to capture pi stderr")?;

        self.sessions.lock().unwrap().insert(
            session_id.clone(),
            PiSession {
                child: Some(child),
                stdin: Some(stdin),
            },
        );

        let stdout_sessions = self.sessions.clone();
        let stdout_id = session_id.clone();
        let stdout_channel = on_event.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);

            for line in reader.lines() {
                let line = match line {
                    Ok(line) => line,
                    Err(err) => {
                        let _ = stdout_channel.send(PiRpcEvent(json!({
                            "type": "process_error",
                            "message": format!("Failed to read pi stdout: {}", err),
                        })));
                        break;
                    }
                };

                let trimmed = line.trim_end_matches('\r');
                if trimmed.trim().is_empty() {
                    continue;
                }

                match serde_json::from_str::<serde_json::Value>(trimmed) {
                    Ok(value) => {
                        if stdout_channel.send(PiRpcEvent(value)).is_err() {
                            break;
                        }
                    }
                    Err(err) => {
                        let _ = stdout_channel.send(PiRpcEvent(json!({
                            "type": "process_error",
                            "message": format!("Invalid pi RPC JSON: {}", err),
                        })));
                    }
                }
            }

            if let Ok(mut sessions) = stdout_sessions.lock() {
                if let Some(session) = sessions.get_mut(&stdout_id) {
                    session.stdin = None;
                    if let Some(mut child) = session.child.take() {
                        let code = child.wait().ok().and_then(|status| status.code());
                        let _ = stdout_channel.send(PiRpcEvent(json!({
                            "type": "process_exit",
                            "code": code,
                        })));
                    }
                }
            }
        });

        let stderr_channel = on_event;
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                let line = match line {
                    Ok(line) => line,
                    Err(_) => break,
                };
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                let _ = stderr_channel.send(PiRpcEvent(json!({
                    "type": "stderr",
                    "message": trimmed,
                })));
            }
        });

        Ok(session_id)
    }

    pub fn send_message(&self, session_id: &str, message: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock().unwrap();
        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| format!("pi session not found: {}", session_id))?;
        session.write_command(&PiCommand::Prompt {
            message: message.to_string(),
        })
    }

    pub fn abort_session(&self, session_id: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock().unwrap();
        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| format!("pi session not found: {}", session_id))?;
        session.write_command(&PiCommand::Abort)
    }

    pub fn destroy_session(&self, session_id: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock().unwrap();
        if let Some(mut session) = sessions.remove(session_id) {
            session.stdin = None;
            if let Some(mut child) = session.child.take() {
                terminate_child(&mut child);
            }
        }
        Ok(())
    }

    pub fn destroy_all(&self) {
        let mut sessions = self.sessions.lock().unwrap();
        for (_, mut session) in sessions.drain() {
            session.stdin = None;
            if let Some(mut child) = session.child.take() {
                terminate_child(&mut child);
            }
        }
    }
}

impl Drop for PiManager {
    fn drop(&mut self) {
        self.destroy_all();
    }
}
