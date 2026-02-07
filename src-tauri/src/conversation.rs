use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::time::UNIX_EPOCH;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationResponse {
    pub messages: Vec<ConversationMessage>,
    pub last_modified: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationMessage {
    pub uuid: String,
    pub role: String,
    pub text: String,
    pub timestamp: String,
}

/// Encode a project directory path the way Claude Code does:
/// replace every non-alphanumeric character with `-`.
fn encode_project_dir(path: &str) -> String {
    path.chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect()
}

/// Find the JSONL conversation file for a project.
/// If session_id is provided, build the deterministic path.
/// Otherwise, find the most recently modified `.jsonl` in the directory.
fn find_jsonl_path(project_path: &str, session_id: Option<&str>) -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    let encoded = encode_project_dir(project_path);
    let dir = home.join(".claude").join("projects").join(&encoded);

    if let Some(sid) = session_id {
        let path = dir.join(format!("{}.jsonl", sid));
        if path.exists() {
            return Some(path);
        }
        return None;
    }

    // Find most recently modified .jsonl file
    let entries = fs::read_dir(&dir).ok()?;
    let mut best: Option<(PathBuf, std::time::SystemTime)> = None;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("jsonl") {
            if let Ok(meta) = path.metadata() {
                if let Ok(mtime) = meta.modified() {
                    if best.as_ref().map_or(true, |(_, t)| mtime > *t) {
                        best = Some((path, mtime));
                    }
                }
            }
        }
    }

    best.map(|(p, _)| p)
}

/// Get the mtime of the conversation file as unix milliseconds.
/// Cheap stat-only check for polling.
pub fn get_mtime(project_path: &str, session_id: Option<&str>) -> Option<f64> {
    let path = find_jsonl_path(project_path, session_id)?;
    let meta = fs::metadata(&path).ok()?;
    let mtime = meta.modified().ok()?;
    let duration = mtime.duration_since(UNIX_EPOCH).ok()?;
    Some(duration.as_secs_f64() * 1000.0)
}

/// Read the conversation JSONL file and extract user + assistant messages.
/// Filters for `type == "assistant"` or `type == "user"` entries where
/// `isSidechain != true` and `isMeta != true`,
/// extracts message content (plain string for user, content[].text array for assistant),
/// deduplicates by uuid (keeps last occurrence).
/// User messages are normalized to role `"human"` for the frontend.
pub fn read_conversation(
    project_path: &str,
    session_id: Option<&str>,
) -> Option<ConversationResponse> {
    let path = find_jsonl_path(project_path, session_id)?;
    let content = fs::read_to_string(&path).ok()?;
    let meta = fs::metadata(&path).ok()?;
    let mtime = meta.modified().ok()?;
    let last_modified = mtime.duration_since(UNIX_EPOCH).ok()?.as_secs_f64() * 1000.0;

    // Parse each line, collect messages, dedup by uuid (keep last)
    let mut messages_map: HashMap<String, ConversationMessage> = HashMap::new();
    let mut order: Vec<String> = Vec::new();

    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        let val: serde_json::Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let role = match val.get("type").and_then(|t| t.as_str()) {
            Some("assistant") => "assistant",
            Some("user") => "human",
            _ => continue,
        };

        // Skip sidechain messages
        if val.get("isSidechain").and_then(|v| v.as_bool()) == Some(true) {
            continue;
        }

        // Skip meta messages (tool_result, bash-output, etc.)
        if val.get("isMeta").and_then(|v| v.as_bool()) == Some(true) {
            continue;
        }

        // Extract uuid: assistant messages have message.id, user messages have top-level uuid
        let uuid = match val
            .get("message")
            .and_then(|m| m.get("id"))
            .and_then(|id| id.as_str())
            .or_else(|| val.get("uuid").and_then(|u| u.as_str()))
        {
            Some(id) => id.to_string(),
            None => continue,
        };

        // Extract timestamp
        let timestamp = val
            .get("timestamp")
            .and_then(|t| t.as_str())
            .unwrap_or("")
            .to_string();

        // Extract content: plain string for user messages, content[].text array for assistant
        let content_val = val.get("message").and_then(|m| m.get("content"));
        let text = if let Some(s) = content_val.and_then(|c| c.as_str()) {
            // User messages: content is a plain string
            s.to_string()
        } else if let Some(arr) = content_val.and_then(|c| c.as_array()) {
            // Assistant messages: content is an array of {type, text} blocks
            arr.iter()
                .filter_map(|item| {
                    if item.get("type").and_then(|t| t.as_str()) == Some("text") {
                        item.get("text").and_then(|t| t.as_str())
                    } else if item.is_string() {
                        item.as_str()
                    } else {
                        None
                    }
                })
                .collect::<Vec<&str>>()
                .join("\n\n")
        } else {
            String::new()
        };

        if text.is_empty() {
            continue;
        }

        if !messages_map.contains_key(&uuid) {
            order.push(uuid.clone());
        }

        messages_map.insert(
            uuid.clone(),
            ConversationMessage {
                uuid,
                role: role.to_string(),
                text,
                timestamp,
            },
        );
    }

    let messages: Vec<ConversationMessage> = order
        .into_iter()
        .filter_map(|uuid| messages_map.remove(&uuid))
        .collect();

    Some(ConversationResponse {
        messages,
        last_modified,
    })
}
