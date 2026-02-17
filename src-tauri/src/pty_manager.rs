use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::ipc::Channel;

pub type SessionId = String;
pub type SubscriberId = String;

const MAX_REPLAY_BYTES: usize = 1024 * 1024;
const MAX_REPLAY_CHUNKS: usize = 2048;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SessionState {
    Running,
    Exited,
    Closing,
    Closed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", content = "data")]
pub enum PtyOutputEvent {
    Data { seq: u64, bytes: Vec<u8> },
    Exit { code: Option<u32> },
    Closed { reason: String },
    Error { message: String },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachStreamResult {
    pub subscriber_id: SubscriberId,
    pub last_seq: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtySessionInfo {
    pub session_id: SessionId,
    pub session_type: String,
    pub state: SessionState,
    pub subscribers: usize,
    pub started_at_ms: f64,
    pub last_seq: u64,
    pub last_exit_code: Option<u32>,
}

#[derive(Debug, Clone)]
struct ReplayChunk {
    seq: u64,
    bytes: Vec<u8>,
}

struct PtySessionMeta {
    session_type: String,
    state: SessionState,
    seq_counter: u64,
    replay: VecDeque<ReplayChunk>,
    replay_bytes: usize,
    subscribers: HashMap<SubscriberId, Channel<PtyOutputEvent>>,
    started_at_ms: f64,
    last_exit_code: Option<u32>,
}

struct PtySession {
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    child: Mutex<Box<dyn portable_pty::Child + Send>>,
    meta: Mutex<PtySessionMeta>,
}

pub struct PtyManager {
    sessions: Arc<Mutex<HashMap<SessionId, Arc<PtySession>>>>,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn create_session(
        &self,
        project_path: &str,
        cols: u16,
        rows: u16,
        session_type: &str,
        claude_session_id: Option<String>,
        resume_session_id: Option<String>,
        continue_session: bool,
    ) -> Result<SessionId, String> {
        let cmd = Self::build_command(
            project_path,
            session_type,
            claude_session_id,
            resume_session_id,
            continue_session,
        )?;

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to open PTY: {}", e))?;

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn process: {}", e))?;
        drop(pair.slave);

        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("Failed to clone reader: {}", e))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("Failed to take writer: {}", e))?;

        let session_id = uuid::Uuid::new_v4().to_string();
        let session = Arc::new(PtySession {
            master: Mutex::new(pair.master),
            writer: Mutex::new(writer),
            child: Mutex::new(child),
            meta: Mutex::new(PtySessionMeta {
                session_type: session_type.to_string(),
                state: SessionState::Running,
                seq_counter: 0,
                replay: VecDeque::new(),
                replay_bytes: 0,
                subscribers: HashMap::new(),
                started_at_ms: now_ms(),
                last_exit_code: None,
            }),
        });

        self.sessions
            .lock()
            .map_err(|e| format!("Lock poisoned in create_session: {}", e))?
            .insert(session_id.clone(), session.clone());

        let sid = session_id.clone();
        std::thread::spawn(move || Self::reader_loop(sid, reader, session));

        Ok(session_id)
    }

    pub fn attach_stream(
        &self,
        session_id: &str,
        replay_from_seq: Option<u64>,
        on_output: Channel<PtyOutputEvent>,
    ) -> Result<AttachStreamResult, String> {
        let session = self.get_session(session_id)?;
        let subscriber_id = uuid::Uuid::new_v4().to_string();
        let from_seq = replay_from_seq.unwrap_or(0);
        let mut channel = Some(on_output);

        let mut meta = session
            .meta
            .lock()
            .map_err(|e| format!("Lock poisoned in attach_stream: {}", e))?;

        if matches!(meta.state, SessionState::Closed | SessionState::Closing) {
            if let Some(ch) = channel.take() {
                let _ = ch.send(PtyOutputEvent::Closed {
                    reason: "session closed".to_string(),
                });
            }
            return Ok(AttachStreamResult {
                subscriber_id,
                last_seq: meta.seq_counter,
            });
        }

        if let Some(ch) = channel.as_ref() {
            for chunk in meta.replay.iter().filter(|chunk| chunk.seq > from_seq) {
                ch.send(PtyOutputEvent::Data {
                    seq: chunk.seq,
                    bytes: chunk.bytes.clone(),
                })
                .map_err(|_| "Failed to send replay data".to_string())?;
            }
        }

        let last_seq = meta.seq_counter;
        if meta.state == SessionState::Running {
            if let Some(ch) = channel.take() {
                meta.subscribers.insert(subscriber_id.clone(), ch);
            }
        } else if meta.state == SessionState::Exited {
            if let Some(ch) = channel.take() {
                let _ = ch.send(PtyOutputEvent::Exit {
                    code: meta.last_exit_code,
                });
            }
        }

        Ok(AttachStreamResult {
            subscriber_id,
            last_seq,
        })
    }

    pub fn detach_stream(&self, session_id: &str, subscriber_id: &str) -> Result<(), String> {
        let session = {
            let guard = self
                .sessions
                .lock()
                .map_err(|e| format!("Lock poisoned in detach_stream: {}", e))?;
            guard.get(session_id).cloned()
        };
        if let Some(session) = session {
            if let Ok(mut meta) = session.meta.lock() {
                meta.subscribers.remove(subscriber_id);
            }
        }
        Ok(())
    }

    pub fn write(&self, session_id: &str, data: &[u8]) -> Result<(), String> {
        let session = self.get_session(session_id)?;
        let mut writer = session
            .writer
            .lock()
            .map_err(|e| format!("Lock poisoned in write: {}", e))?;
        writer
            .write_all(data)
            .map_err(|e| format!("Write failed: {}", e))?;
        writer.flush().map_err(|e| format!("Flush failed: {}", e))
    }

    pub fn resize(&self, session_id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let session = self.get_session(session_id)?;
        let master = session
            .master
            .lock()
            .map_err(|e| format!("Lock poisoned in resize: {}", e))?;
        master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Resize failed: {}", e))
    }

    pub fn close_session(&self, session_id: &str, reason: &str) -> Result<(), String> {
        let removed = {
            let mut sessions = self
                .sessions
                .lock()
                .map_err(|e| format!("Lock poisoned in close_session: {}", e))?;
            sessions.remove(session_id)
        };
        if let Some(session) = removed {
            Self::close_session_handle(&session, reason);
        }
        Ok(())
    }

    pub fn close_all(&self, reason: &str) {
        let drained: Vec<Arc<PtySession>> = {
            let mut sessions = self
                .sessions
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            sessions.drain().map(|(_, session)| session).collect()
        };

        for session in drained {
            Self::close_session_handle(&session, reason);
        }
    }

    pub fn get_info(&self, session_id: &str) -> Result<PtySessionInfo, String> {
        let session = self.get_session(session_id)?;
        let meta = session
            .meta
            .lock()
            .map_err(|e| format!("Lock poisoned in get_info: {}", e))?;
        Ok(PtySessionInfo {
            session_id: session_id.to_string(),
            session_type: meta.session_type.clone(),
            state: meta.state,
            subscribers: meta.subscribers.len(),
            started_at_ms: meta.started_at_ms,
            last_seq: meta.seq_counter,
            last_exit_code: meta.last_exit_code,
        })
    }

    fn get_session(&self, session_id: &str) -> Result<Arc<PtySession>, String> {
        let sessions = self
            .sessions
            .lock()
            .map_err(|e| format!("Lock poisoned in get_session: {}", e))?;
        sessions
            .get(session_id)
            .cloned()
            .ok_or_else(|| format!("Session not found: {}", session_id))
    }

    fn build_command(
        project_path: &str,
        session_type: &str,
        claude_session_id: Option<String>,
        resume_session_id: Option<String>,
        continue_session: bool,
    ) -> Result<CommandBuilder, String> {
        let mut cmd = CommandBuilder::new("cmd.exe");

        match session_type {
            "shell" => {}
            "opencode" => {
                if continue_session {
                    cmd.args(["/c", "opencode", "--continue"]);
                } else {
                    cmd.args(["/c", "opencode"]);
                }
            }
            "codex" => {
                if continue_session {
                    cmd.args(["/c", "codex", "resume", "--last"]);
                } else {
                    cmd.args(["/c", "codex"]);
                }
            }
            "claude" => {
                let resume_id = resume_session_id
                    .as_deref()
                    .map(str::trim)
                    .filter(|id| !id.is_empty());
                let explicit_session_id = claude_session_id
                    .as_deref()
                    .map(str::trim)
                    .filter(|id| !id.is_empty());

                if let Some(id) = resume_id {
                    cmd.args(["/c", "claude", "--resume", id]);
                } else if let Some(id) = explicit_session_id {
                    cmd.args(["/c", "claude", "--session-id", id]);
                } else if continue_session {
                    cmd.args(["/c", "claude", "--continue"]);
                } else {
                    cmd.args(["/c", "claude"]);
                }
            }
            other => return Err(format!("Unsupported session type: {}", other)),
        }

        cmd.cwd(project_path);
        Ok(cmd)
    }

    fn reader_loop(
        session_id: SessionId,
        mut reader: Box<dyn Read + Send>,
        session: Arc<PtySession>,
    ) {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => Self::record_data(&session, buf[..n].to_vec()),
                Err(err) => {
                    Self::broadcast(
                        &session,
                        PtyOutputEvent::Error {
                            message: format!("PTY read failed for {}: {}", session_id, err),
                        },
                    );
                    break;
                }
            }
        }

        let exit_code = {
            let mut child = match session.child.lock() {
                Ok(child) => child,
                Err(poisoned) => poisoned.into_inner(),
            };
            child
                .try_wait()
                .ok()
                .flatten()
                .map(|status| status.exit_code())
        };

        let should_broadcast = {
            let mut meta = match session.meta.lock() {
                Ok(meta) => meta,
                Err(poisoned) => poisoned.into_inner(),
            };
            if matches!(meta.state, SessionState::Closing | SessionState::Closed) {
                false
            } else {
                meta.state = SessionState::Exited;
                meta.last_exit_code = exit_code;
                true
            }
        };

        if should_broadcast {
            Self::broadcast(&session, PtyOutputEvent::Exit { code: exit_code });
        }
    }

    fn record_data(session: &Arc<PtySession>, bytes: Vec<u8>) {
        let event = {
            let mut meta = match session.meta.lock() {
                Ok(meta) => meta,
                Err(poisoned) => poisoned.into_inner(),
            };
            if meta.state != SessionState::Running {
                return;
            }

            meta.seq_counter = meta.seq_counter.saturating_add(1);
            let seq = meta.seq_counter;
            meta.replay_bytes = meta.replay_bytes.saturating_add(bytes.len());
            meta.replay.push_back(ReplayChunk {
                seq,
                bytes: bytes.clone(),
            });
            while meta.replay_bytes > MAX_REPLAY_BYTES || meta.replay.len() > MAX_REPLAY_CHUNKS {
                if let Some(oldest) = meta.replay.pop_front() {
                    meta.replay_bytes = meta.replay_bytes.saturating_sub(oldest.bytes.len());
                } else {
                    break;
                }
            }

            PtyOutputEvent::Data { seq, bytes }
        };

        Self::broadcast(session, event);
    }

    fn broadcast(session: &Arc<PtySession>, event: PtyOutputEvent) {
        let mut meta = match session.meta.lock() {
            Ok(meta) => meta,
            Err(poisoned) => poisoned.into_inner(),
        };
        let mut dead = Vec::new();
        for (subscriber_id, channel) in meta.subscribers.iter() {
            if channel.send(event.clone()).is_err() {
                dead.push(subscriber_id.clone());
            }
        }
        for subscriber_id in dead {
            meta.subscribers.remove(&subscriber_id);
        }
    }

    fn close_session_handle(session: &Arc<PtySession>, reason: &str) {
        {
            let mut meta = match session.meta.lock() {
                Ok(meta) => meta,
                Err(poisoned) => poisoned.into_inner(),
            };
            if meta.state == SessionState::Closed {
                return;
            }
            meta.state = SessionState::Closing;
        }

        {
            let mut child = match session.child.lock() {
                Ok(child) => child,
                Err(poisoned) => poisoned.into_inner(),
            };
            let _ = child.kill();
        }

        let mut meta = match session.meta.lock() {
            Ok(meta) => meta,
            Err(poisoned) => poisoned.into_inner(),
        };
        meta.state = SessionState::Closed;
        let mut dead = Vec::new();
        let closed_event = PtyOutputEvent::Closed {
            reason: reason.to_string(),
        };
        for (subscriber_id, channel) in meta.subscribers.iter() {
            if channel.send(closed_event.clone()).is_err() {
                dead.push(subscriber_id.clone());
            }
        }
        for subscriber_id in dead {
            meta.subscribers.remove(&subscriber_id);
        }
        meta.subscribers.clear();
    }
}

impl Drop for PtyManager {
    fn drop(&mut self) {
        self.close_all("manager_drop");
    }
}

fn now_ms() -> f64 {
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(duration) => duration.as_millis() as f64,
        Err(_) => 0.0,
    }
}
