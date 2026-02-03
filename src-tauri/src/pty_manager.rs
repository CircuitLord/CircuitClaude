use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;
use serde::Serialize;

pub type SessionId = String;

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", content = "data")]
pub enum PtyOutputEvent {
    Data(Vec<u8>),
    Exit(Option<u32>),
}

struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn portable_pty::Child + Send>,
}

pub struct PtyManager {
    sessions: Arc<Mutex<HashMap<SessionId, PtySession>>>,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn spawn(
        &self,
        project_path: &str,
        cols: u16,
        rows: u16,
        continue_session: bool,
        on_output: Channel<PtyOutputEvent>,
    ) -> Result<SessionId, String> {
        let pty_system = native_pty_system();

        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to open PTY: {}", e))?;

        let mut cmd = CommandBuilder::new("cmd.exe");
        if continue_session {
            cmd.args(["/c", "claude", "--continue"]);
        } else {
            cmd.args(["/c", "claude"]);
        }
        cmd.cwd(project_path);

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn claude: {}", e))?;

        // Drop slave after spawning - we don't need it anymore
        drop(pair.slave);

        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("Failed to clone reader: {}", e))?;

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("Failed to take writer: {}", e))?;

        let session_id = uuid::Uuid::new_v4().to_string();

        let session = PtySession {
            master: pair.master,
            writer,
            child,
        };

        self.sessions
            .lock()
            .unwrap()
            .insert(session_id.clone(), session);

        // Spawn reader thread
        let sessions_ref = self.sessions.clone();
        let sid = session_id.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let data = buf[..n].to_vec();
                        if on_output.send(PtyOutputEvent::Data(data)).is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }

            // Process exited - get exit code
            let exit_code = sessions_ref
                .lock()
                .unwrap()
                .get_mut(&sid)
                .and_then(|s| s.child.try_wait().ok().flatten())
                .map(|status| status.exit_code());

            let _ = on_output.send(PtyOutputEvent::Exit(exit_code));
        });

        Ok(session_id)
    }

    pub fn write(&self, session_id: &str, data: &[u8]) -> Result<(), String> {
        let mut sessions = self.sessions.lock().unwrap();
        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| format!("Session not found: {}", session_id))?;
        session
            .writer
            .write_all(data)
            .map_err(|e| format!("Write failed: {}", e))?;
        session
            .writer
            .flush()
            .map_err(|e| format!("Flush failed: {}", e))
    }

    pub fn resize(&self, session_id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let sessions = self.sessions.lock().unwrap();
        let session = sessions
            .get(session_id)
            .ok_or_else(|| format!("Session not found: {}", session_id))?;
        session
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Resize failed: {}", e))
    }

    pub fn kill(&self, session_id: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock().unwrap();
        if let Some(mut session) = sessions.remove(session_id) {
            session.child.kill().map_err(|e| format!("Kill failed: {}", e))
        } else {
            Ok(()) // Already removed
        }
    }
}
