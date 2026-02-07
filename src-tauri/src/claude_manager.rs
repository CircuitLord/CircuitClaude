use serde::Serialize;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;

#[derive(Debug, Clone, Serialize)]
pub struct ModelUsage {
    pub model: String,
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub cache_read_input_tokens: u32,
    pub cache_creation_input_tokens: u32,
    pub context_window: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", content = "data")]
pub enum ClaudeEvent {
    MessageStart,
    Text { text: String },
    Thinking { text: String },
    ToolUse { id: String, name: String, input: serde_json::Value },
    ToolResult { tool_use_id: String, content: String, is_error: bool },
    PermissionRequest { id: String, tool: String, input: serde_json::Value, description: String },
    UserQuestion { id: String, questions: serde_json::Value },
    Result { subtype: String, duration_ms: f64, is_error: bool, num_turns: u32, session_id: String, model_usage: Option<ModelUsage> },
    Error { message: String },
    System { session_id: String, model: String },
    Ready,
    MessageStop,
}

/// A command sent to the bridge process via stdin.
#[derive(Serialize)]
#[serde(tag = "type")]
enum BridgeCommand {
    #[serde(rename = "init")]
    Init { #[serde(rename = "projectPath")] project_path: String },
    #[serde(rename = "message")]
    Message { text: String },
    #[serde(rename = "permission_response")]
    PermissionResponse { id: String, allowed: bool, message: Option<String>, #[serde(rename = "updatedInput", skip_serializing_if = "Option::is_none")] updated_input: Option<serde_json::Value> },
    #[serde(rename = "abort")]
    Abort,
}

struct ClaudeSession {
    child: Option<Child>,
    stdin: Option<std::process::ChildStdin>,
    #[allow(dead_code)]
    project_path: String,
}

impl ClaudeSession {
    fn write_command(&mut self, cmd: &BridgeCommand) -> Result<(), String> {
        let stdin = self.stdin.as_mut().ok_or("Bridge stdin not available")?;
        let json = serde_json::to_string(cmd).map_err(|e| e.to_string())?;
        stdin.write_all(json.as_bytes()).map_err(|e| format!("Write to bridge stdin failed: {}", e))?;
        stdin.write_all(b"\n").map_err(|e| format!("Write newline failed: {}", e))?;
        stdin.flush().map_err(|e| format!("Flush failed: {}", e))?;
        Ok(())
    }
}

pub struct ClaudeManager {
    sessions: Arc<Mutex<HashMap<String, ClaudeSession>>>,
    bridge_path: String,
}

impl ClaudeManager {
    pub fn new(bridge_path: String) -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            bridge_path,
        }
    }

    pub fn create_session(
        &self,
        project_path: &str,
        on_event: Channel<ClaudeEvent>,
    ) -> Result<String, String> {
        let tab_id = uuid::Uuid::new_v4().to_string();

        // Spawn the bridge process
        let mut cmd = Command::new("node");
        cmd.arg(&self.bridge_path);
        cmd.current_dir(project_path);
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());
        cmd.stdin(Stdio::piped());

        // CREATE_NO_WINDOW on Windows
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000);
        }

        let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn bridge: {}", e))?;

        let stdin = child.stdin.take().ok_or("Failed to capture bridge stdin")?;
        let stdout = child.stdout.take().ok_or("Failed to capture bridge stdout")?;
        let stderr = child.stderr.take().ok_or("Failed to capture bridge stderr")?;

        let mut session = ClaudeSession {
            child: Some(child),
            stdin: Some(stdin),
            project_path: project_path.to_string(),
        };

        // Send init command
        session.write_command(&BridgeCommand::Init {
            project_path: project_path.to_string(),
        })?;

        self.sessions.lock().unwrap().insert(tab_id.clone(), session);

        // Spawn stdout reader thread (lives for session lifetime)
        let sessions_ref = self.sessions.clone();
        let tid = tab_id.clone();

        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);

            for line in reader.lines() {
                let line = match line {
                    Ok(l) => l,
                    Err(_) => break,
                };

                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }

                let val: serde_json::Value = match serde_json::from_str(trimmed) {
                    Ok(v) => v,
                    Err(_) => continue,
                };

                if let Some(evt) = parse_bridge_event(&val) {
                    if on_event.send(evt).is_err() {
                        break;
                    }
                }
            }

            // Bridge process exited — clean up
            if let Ok(mut guard) = sessions_ref.lock() {
                if let Some(session) = guard.get_mut(&tid) {
                    session.stdin = None;
                    if let Some(mut child) = session.child.take() {
                        let _ = child.wait();
                    }
                }
            }
        });

        // Spawn stderr reader (just log it)
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                match line {
                    Ok(l) => eprintln!("[bridge stderr] {}", l),
                    Err(_) => break,
                }
            }
        });

        Ok(tab_id)
    }

    pub fn send_message(
        &self,
        tab_id: &str,
        message: &str,
    ) -> Result<(), String> {
        let mut sessions = self.sessions.lock().unwrap();
        let session = sessions
            .get_mut(tab_id)
            .ok_or_else(|| format!("Session not found: {}", tab_id))?;

        session.write_command(&BridgeCommand::Message {
            text: message.to_string(),
        })
    }

    pub fn respond_to_permission(
        &self,
        tab_id: &str,
        id: &str,
        allowed: bool,
        message: Option<String>,
    ) -> Result<(), String> {
        let mut sessions = self.sessions.lock().unwrap();
        let session = sessions
            .get_mut(tab_id)
            .ok_or_else(|| format!("Session not found: {}", tab_id))?;

        session.write_command(&BridgeCommand::PermissionResponse {
            id: id.to_string(),
            allowed,
            message,
            updated_input: None,
        })
    }

    pub fn respond_to_question(
        &self,
        tab_id: &str,
        id: &str,
        answers: serde_json::Value,
    ) -> Result<(), String> {
        let mut sessions = self.sessions.lock().unwrap();
        let session = sessions
            .get_mut(tab_id)
            .ok_or_else(|| format!("Session not found: {}", tab_id))?;

        // For AskUserQuestion, we allow with updatedInput containing the answers
        let mut updated_input = serde_json::Map::new();
        updated_input.insert("answers".to_string(), answers);

        session.write_command(&BridgeCommand::PermissionResponse {
            id: id.to_string(),
            allowed: true,
            message: None,
            updated_input: Some(serde_json::Value::Object(updated_input)),
        })
    }

    pub fn interrupt_session(&self, tab_id: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock().unwrap();
        let session = sessions
            .get_mut(tab_id)
            .ok_or_else(|| format!("Session not found: {}", tab_id))?;

        session.write_command(&BridgeCommand::Abort)
    }

    pub fn destroy_session(&self, tab_id: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock().unwrap();
        if let Some(mut session) = sessions.remove(tab_id) {
            // Drop stdin first to signal EOF to the bridge
            session.stdin = None;
            if let Some(mut child) = session.child.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
        Ok(())
    }

    pub fn destroy_all(&self) {
        let mut sessions = self.sessions.lock().unwrap();
        for (_, mut session) in sessions.drain() {
            session.stdin = None;
            if let Some(mut child) = session.child.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

impl Drop for ClaudeManager {
    fn drop(&mut self) {
        self.destroy_all();
    }
}

/// Parse a JSON line from the bridge stdout into a ClaudeEvent.
fn parse_bridge_event(val: &serde_json::Value) -> Option<ClaudeEvent> {
    let event_type = val.get("type").and_then(|t| t.as_str())?;

    match event_type {
        "ready" => Some(ClaudeEvent::Ready),

        "system" => {
            let session_id = val.get("session_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let model = val.get("model").and_then(|v| v.as_str()).unwrap_or("").to_string();
            Some(ClaudeEvent::System { session_id, model })
        }

        "message_start" => Some(ClaudeEvent::MessageStart),
        "message_stop" => Some(ClaudeEvent::MessageStop),

        "text" => {
            let text = val.get("text").and_then(|t| t.as_str()).unwrap_or("").to_string();
            Some(ClaudeEvent::Text { text })
        }

        "thinking" => {
            let text = val.get("text").and_then(|t| t.as_str()).unwrap_or("").to_string();
            Some(ClaudeEvent::Thinking { text })
        }

        "tool_use" => {
            let id = val.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let name = val.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let input = val.get("input").cloned().unwrap_or(serde_json::Value::Null);
            Some(ClaudeEvent::ToolUse { id, name, input })
        }

        "tool_result" => {
            let tool_use_id = val.get("tool_use_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let content = val.get("content").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let is_error = val.get("is_error").and_then(|v| v.as_bool()).unwrap_or(false);
            Some(ClaudeEvent::ToolResult { tool_use_id, content, is_error })
        }

        "permission_request" => {
            let id = val.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let tool = val.get("tool").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let input = val.get("input").cloned().unwrap_or(serde_json::Value::Null);
            let description = val.get("description").and_then(|v| v.as_str()).unwrap_or("").to_string();
            Some(ClaudeEvent::PermissionRequest { id, tool, input, description })
        }

        "user_question" => {
            let id = val.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let questions = val.get("questions").cloned().unwrap_or(serde_json::Value::Array(vec![]));
            Some(ClaudeEvent::UserQuestion { id, questions })
        }

        "result" => {
            let subtype = val.get("subtype").and_then(|v| v.as_str()).unwrap_or("success").to_string();
            let duration_ms = val.get("duration_ms").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let is_error = val.get("is_error").and_then(|v| v.as_bool()).unwrap_or(false);
            let num_turns = val.get("num_turns").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
            let session_id = val.get("session_id").and_then(|v| v.as_str()).unwrap_or("").to_string();

            // Extract first entry from model_usage map
            let mu_obj = val.get("model_usage").and_then(|mu| mu.as_object());
            let model_usage = mu_obj
                .and_then(|map| map.iter().next())
                .map(|(model_name, usage)| ModelUsage {
                    model: model_name.clone(),
                    input_tokens: usage.get("inputTokens").or_else(|| usage.get("input_tokens")).and_then(|v| v.as_u64()).unwrap_or(0) as u32,
                    output_tokens: usage.get("outputTokens").or_else(|| usage.get("output_tokens")).and_then(|v| v.as_u64()).unwrap_or(0) as u32,
                    cache_read_input_tokens: usage.get("cacheReadInputTokens").or_else(|| usage.get("cache_read_input_tokens")).and_then(|v| v.as_u64()).unwrap_or(0) as u32,
                    cache_creation_input_tokens: usage.get("cacheCreationInputTokens").or_else(|| usage.get("cache_creation_input_tokens")).and_then(|v| v.as_u64()).unwrap_or(0) as u32,
                    context_window: usage.get("contextWindow").or_else(|| usage.get("context_window")).and_then(|v| v.as_u64()).unwrap_or(0) as u32,
                });

            Some(ClaudeEvent::Result {
                subtype,
                duration_ms,
                is_error,
                num_turns,
                session_id,
                model_usage,
            })
        }

        "error" => {
            let message = val.get("message").and_then(|v| v.as_str()).unwrap_or("Unknown error").to_string();
            Some(ClaudeEvent::Error { message })
        }

        _ => None,
    }
}
