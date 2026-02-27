use crate::codex_title;
use crate::conversation;
use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use std::time::UNIX_EPOCH;

/// Generate a tab title for a Claude Code session by reading its JSONL file.
///
/// Finds the most recently modified `.jsonl` in `~/.claude/projects/<encoded>/`
/// that was modified after `spawned_at_ms`, extracts user prompts, and uses
/// Haiku to generate a concise title (with a deterministic fallback).
pub fn generate_claude_title(
    project_path: &str,
    spawned_at_ms: f64,
    max_chars: usize,
    prompt_limit: usize,
    context_char_budget: usize,
) -> Result<String, String> {
    let max_chars = max_chars.clamp(8, 120);
    let prompt_limit = prompt_limit.clamp(1, 12);
    let context_char_budget = context_char_budget.clamp(40, 4000);

    let session_file = find_matching_session_file(project_path, spawned_at_ms)?
        .ok_or_else(|| "No matching Claude session file found".to_string())?;
    let prompts = extract_user_prompts(&session_file, prompt_limit)?;
    let prompt_context = codex_title::pack_prompt_context(&prompts, context_char_budget);

    if prompt_context.is_empty() {
        return Err("No user prompts found in matching Claude session file".to_string());
    }

    match codex_title::run_haiku_title_generation(project_path, &prompt_context, max_chars) {
        Ok(title) if !title.is_empty() => Ok(title),
        Ok(_) | Err(_) => {
            let fallback = codex_title::deterministic_title_from_prompts(&prompt_context, max_chars)
                .ok_or_else(|| "Failed to generate a Claude tab title".to_string())?;
            eprintln!("[claude_title] fallback_title title={}", fallback);
            Ok(fallback)
        }
    }
}

/// Find the most recently modified `.jsonl` in `~/.claude/projects/<encoded>/`
/// that was modified after `spawned_at_ms`.
fn find_matching_session_file(
    project_path: &str,
    spawned_at_ms: f64,
) -> Result<Option<PathBuf>, String> {
    let home = dirs::home_dir().ok_or_else(|| "Could not find home directory".to_string())?;
    let encoded = conversation::encode_project_dir(project_path);
    let dir = home.join(".claude").join("projects").join(&encoded);

    if !dir.exists() {
        return Ok(None);
    }

    let entries = fs::read_dir(&dir).map_err(|e| format!("Failed to read Claude projects dir: {}", e))?;

    let mut best: Option<(PathBuf, f64)> = None;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
            continue;
        }
        let Some(mtime_ms) = file_mtime_ms(&path) else {
            continue;
        };
        if mtime_ms < spawned_at_ms {
            continue;
        }
        if best.as_ref().map_or(true, |(_, t)| mtime_ms > *t) {
            best = Some((path, mtime_ms));
        }
    }

    Ok(best.map(|(p, _)| p))
}

fn file_mtime_ms(path: &PathBuf) -> Option<f64> {
    let meta = fs::metadata(path).ok()?;
    let modified = meta.modified().ok()?;
    let duration = modified.duration_since(UNIX_EPOCH).ok()?;
    Some(duration.as_secs_f64() * 1000.0)
}

/// Extract user prompts from a Claude Code JSONL session file.
///
/// Claude Code JSONL format:
/// - Lines with `"type": "user"` contain user messages
/// - Skip lines with `"isSidechain": true` or `"isMeta": true`
/// - `message.content` can be a plain string or an array of content blocks
fn extract_user_prompts(path: &PathBuf, prompt_limit: usize) -> Result<Vec<String>, String> {
    let content =
        fs::read_to_string(path).map_err(|e| format!("Failed to read session file: {}", e))?;

    let mut prompts_oldest_first: Vec<String> = Vec::new();

    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        let val: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };

        // Claude JSONL: type field indicates the message role
        let msg_type = match val.get("type").and_then(|t| t.as_str()) {
            Some(t) => t,
            None => continue,
        };

        if msg_type != "user" {
            continue;
        }

        // Skip sidechain messages
        if val.get("isSidechain").and_then(|v| v.as_bool()) == Some(true) {
            continue;
        }

        // Skip meta messages
        if val.get("isMeta").and_then(|v| v.as_bool()) == Some(true) {
            continue;
        }

        // Extract content from message.content
        let content_val = val.get("message").and_then(|m| m.get("content"));
        let text = extract_text_from_content(content_val);

        if text.is_empty() {
            continue;
        }

        let combined = codex_title::collapse_whitespace(&text);
        if let Some(filtered) = codex_title::sanitize_user_prompt_for_title(&combined) {
            prompts_oldest_first.push(filtered);
        }
    }

    // Return newest first, limited to prompt_limit
    let prompts_newest_first: Vec<String> = prompts_oldest_first
        .into_iter()
        .rev()
        .take(prompt_limit)
        .collect();
    Ok(prompts_newest_first)
}

/// Extract plain text from Claude Code message content.
/// Content can be a string, an object with "text" field, or an array of content blocks.
fn extract_text_from_content(content: Option<&Value>) -> String {
    let Some(content) = content else {
        return String::new();
    };

    match content {
        Value::String(s) => codex_title::collapse_whitespace(s),
        Value::Object(obj) => {
            if obj.get("type").and_then(|v| v.as_str()) == Some("text") {
                obj.get("text")
                    .and_then(|v| v.as_str())
                    .map(|s| codex_title::collapse_whitespace(s))
                    .unwrap_or_default()
            } else {
                String::new()
            }
        }
        Value::Array(items) => {
            let mut parts = Vec::new();
            for item in items {
                if let Some(s) = item.as_str() {
                    let clean = codex_title::collapse_whitespace(s);
                    if !clean.is_empty() {
                        parts.push(clean);
                    }
                } else if item.get("type").and_then(|v| v.as_str()) == Some("text") {
                    if let Some(text) = item.get("text").and_then(|v| v.as_str()) {
                        let clean = codex_title::collapse_whitespace(text);
                        if !clean.is_empty() {
                            parts.push(clean);
                        }
                    }
                }
            }
            parts.join(" ")
        }
        _ => String::new(),
    }
}
