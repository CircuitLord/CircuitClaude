use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::time::UNIX_EPOCH;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationResponse {
    pub messages: Vec<AssistantMessage>,
    pub last_modified: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantMessage {
    pub uuid: String,
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

/// Read the conversation JSONL file and extract assistant messages.
/// Filters for `type == "assistant"` entries where `isSidechain != true`,
/// extracts `message.content[].text`, deduplicates by uuid (keeps last occurrence).
pub fn read_conversation(
    project_path: &str,
    session_id: Option<&str>,
) -> Option<ConversationResponse> {
    let path = find_jsonl_path(project_path, session_id)?;
    let content = fs::read_to_string(&path).ok()?;
    let meta = fs::metadata(&path).ok()?;
    let mtime = meta.modified().ok()?;
    let last_modified = mtime
        .duration_since(UNIX_EPOCH)
        .ok()?
        .as_secs_f64()
        * 1000.0;

    // Parse each line, collect assistant messages, dedup by uuid (keep last)
    let mut messages_map: HashMap<String, AssistantMessage> = HashMap::new();
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

        // Must be type "assistant"
        if val.get("type").and_then(|t| t.as_str()) != Some("assistant") {
            continue;
        }

        // Skip sidechain messages
        if val.get("isSidechain").and_then(|v| v.as_bool()) == Some(true) {
            continue;
        }

        // Extract uuid
        let uuid = match val
            .get("message")
            .and_then(|m| m.get("id"))
            .and_then(|id| id.as_str())
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

        // Join all content[].text blocks
        let text = val
            .get("message")
            .and_then(|m| m.get("content"))
            .and_then(|c| c.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|item| {
                        // Only text blocks (type == "text" or no type field with direct text)
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
            })
            .unwrap_or_default();

        if text.is_empty() {
            continue;
        }

        if !messages_map.contains_key(&uuid) {
            order.push(uuid.clone());
        }

        messages_map.insert(
            uuid.clone(),
            AssistantMessage {
                uuid,
                text,
                timestamp,
            },
        );
    }

    let messages: Vec<AssistantMessage> = order
        .into_iter()
        .filter_map(|uuid| messages_map.remove(&uuid))
        .collect();

    Some(ConversationResponse {
        messages,
        last_modified,
    })
}
