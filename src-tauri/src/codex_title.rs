use serde_json::Value;
use std::fs::File;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::UNIX_EPOCH;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

const TITLE_MODEL: &str = "claude-haiku-4-5-20251001";
const MAX_HAIKU_USER_PROMPT_CHARS: usize = 200;

pub fn generate_codex_title(
    project_path: &str,
    spawned_at_ms: f64,
    max_chars: usize,
    prompt_limit: usize,
) -> Result<String, String> {
    let max_chars = max_chars.clamp(8, 120);
    let prompt_limit = prompt_limit.clamp(1, 12);

    let session_file = find_matching_session_file(project_path, spawned_at_ms)?
        .ok_or_else(|| "No matching Codex session file found".to_string())?;
    let prompts = extract_user_prompts(&session_file, spawned_at_ms, prompt_limit)?;

    if prompts.is_empty() {
        return Err("No user prompts found in matching Codex session file".to_string());
    }

    match run_haiku_title_generation(project_path, &prompts, max_chars) {
        Ok(title) if !title.is_empty() => Ok(title),
        Ok(_) | Err(_) => {
            let fallback = deterministic_title_from_prompts(&prompts, max_chars)
                .ok_or_else(|| "Failed to generate a Codex tab title".to_string())?;
            eprintln!("[codex_title] fallback_title title={}", fallback);
            Ok(fallback)
        }
    }
}

fn find_matching_session_file(project_path: &str, spawned_at_ms: f64) -> Result<Option<PathBuf>, String> {
    let home = dirs::home_dir().ok_or_else(|| "Could not find home directory".to_string())?;
    let sessions_root = home.join(".codex").join("sessions");
    if !sessions_root.exists() {
        return Ok(None);
    }

    let normalized_project = normalize_compare_path(project_path);
    let mut after_spawn_by_start: Vec<(PathBuf, f64)> = Vec::new();
    let mut after_spawn_by_mtime: Vec<(PathBuf, f64)> = Vec::new();

    for path in collect_jsonl_files(&sessions_root) {
        let Some((session_cwd, session_started_ms)) = extract_session_meta(&path) else {
            continue;
        };
        if normalize_compare_path(&session_cwd) != normalized_project {
            continue;
        }
        if session_started_ms >= spawned_at_ms {
            after_spawn_by_start.push((path, session_started_ms));
            continue;
        }
        if let Some(mtime_ms) = file_mtime_ms(&path) {
            if mtime_ms >= spawned_at_ms {
                after_spawn_by_mtime.push((path, mtime_ms));
            }
        }
    }

    if let Some(path) = after_spawn_by_start
        .into_iter()
        .min_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal))
        .map(|(path, _)| path)
    {
        return Ok(Some(path));
    }

    Ok(after_spawn_by_mtime
        .into_iter()
        .min_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal))
        .map(|(path, _)| path))
}

fn collect_jsonl_files(root: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    let mut stack = vec![root.to_path_buf()];

    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if path
                .extension()
                .and_then(|ext| ext.to_str())
                .map(|ext| ext.eq_ignore_ascii_case("jsonl"))
                .unwrap_or(false)
            {
                files.push(path);
            }
        }
    }

    files
}

fn extract_session_meta(path: &Path) -> Option<(String, f64)> {
    let file = File::open(path).ok()?;
    let reader = BufReader::new(file);

    for line_result in reader.lines().take(64) {
        let line = match line_result {
            Ok(v) => v,
            Err(_) => continue,
        };
        let val: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if val.get("type").and_then(|t| t.as_str()) != Some("session_meta") {
            continue;
        }

        let payload = val.get("payload")?;
        let cwd = payload.get("cwd").and_then(|v| v.as_str())?;
        let ts_raw = payload.get("timestamp").and_then(|v| v.as_str())?;
        let started = chrono::DateTime::parse_from_rfc3339(ts_raw).ok()?;
        let started_ms = started.timestamp_millis() as f64;
        return Some((cwd.to_string(), started_ms));
    }

    None
}

fn extract_user_prompts(path: &Path, spawned_at_ms: f64, prompt_limit: usize) -> Result<Vec<String>, String> {
    let file = File::open(path).map_err(|e| format!("Failed to open session file: {}", e))?;
    let reader = BufReader::new(file);
    let mut prompts_oldest_first: Vec<String> = Vec::new();

    for line_result in reader.lines() {
        let line = match line_result {
            Ok(v) => v,
            Err(_) => continue,
        };
        if line.trim().is_empty() {
            continue;
        }

        let val: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if val.get("type").and_then(|v| v.as_str()) != Some("response_item") {
            continue;
        }

        let Some(payload) = val.get("payload") else {
            continue;
        };
        if payload.get("type").and_then(|v| v.as_str()) != Some("message") {
            continue;
        }
        if payload.get("role").and_then(|v| v.as_str()) != Some("user") {
            continue;
        }
        let ts = match val
            .get("timestamp")
            .and_then(|v| v.as_str())
            .and_then(parse_rfc3339_ms)
        {
            Some(v) => v,
            None => continue,
        };
        if ts < spawned_at_ms {
            continue;
        }

        let blocks = extract_input_text_blocks(payload.get("content"));
        if blocks.is_empty() {
            continue;
        }

        let combined = collapse_whitespace(&blocks.join(" "));
        if let Some(filtered) = sanitize_user_prompt_for_title(&combined) {
            prompts_oldest_first.push(filtered);
        }
    }

    let prompts_newest_first: Vec<String> = prompts_oldest_first
        .into_iter()
        .rev()
        .take(prompt_limit)
        .collect();
    Ok(prompts_newest_first)
}

fn parse_rfc3339_ms(value: &str) -> Option<f64> {
    chrono::DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|dt| dt.timestamp_millis() as f64)
}

fn file_mtime_ms(path: &Path) -> Option<f64> {
    let meta = std::fs::metadata(path).ok()?;
    let modified = meta.modified().ok()?;
    let duration = modified.duration_since(UNIX_EPOCH).ok()?;
    Some(duration.as_secs_f64() * 1000.0)
}

fn extract_input_text_blocks(content: Option<&Value>) -> Vec<String> {
    let mut blocks = Vec::new();
    let Some(content) = content else {
        return blocks;
    };

    match content {
        Value::String(text) => {
            let clean = collapse_whitespace(text);
            if !clean.is_empty() {
                blocks.push(clean);
            }
        }
        Value::Object(obj) => {
            if obj.get("type").and_then(|v| v.as_str()) == Some("input_text") {
                if let Some(text) = obj.get("text").and_then(|v| v.as_str()) {
                    let clean = collapse_whitespace(text);
                    if !clean.is_empty() {
                        blocks.push(clean);
                    }
                }
            }
        }
        Value::Array(items) => {
            for item in items {
                if item.get("type").and_then(|v| v.as_str()) == Some("input_text") {
                    if let Some(text) = item.get("text").and_then(|v| v.as_str()) {
                        let clean = collapse_whitespace(text);
                        if !clean.is_empty() {
                            blocks.push(clean);
                        }
                    }
                } else if let Some(text) = item.as_str() {
                    let clean = collapse_whitespace(text);
                    if !clean.is_empty() {
                        blocks.push(clean);
                    }
                }
            }
        }
        _ => {}
    }

    blocks
}

fn run_haiku_title_generation(
    project_path: &str,
    prompts_newest_first: &[String],
    max_chars: usize,
) -> Result<String, String> {
    let prompt = build_title_generation_prompt(prompts_newest_first, max_chars);
    eprintln!(
        "[codex_title] haiku_request model={} max_chars={} prompt={}",
        TITLE_MODEL, max_chars, prompt
    );

    let mut cmd = build_haiku_command(project_path);
    let mut child = cmd
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to launch Claude CLI for title generation: {}", e))?;

    {
        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Failed to open Claude CLI stdin".to_string())?;
        stdin
            .write_all(prompt.as_bytes())
            .map_err(|e| format!("Failed to write to Claude CLI stdin: {}", e))?;
    }

    let output = child
        .wait_with_output()
        .map_err(|e| format!("Failed to wait for Claude CLI: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if !stderr.is_empty() { stderr } else { stdout };
        eprintln!(
            "[codex_title] haiku_error status={} detail={}",
            output.status, detail
        );
        return Err(format!(
            "Claude CLI failed (exit {}): {}",
            output.status, detail
        ));
    }

    let raw = String::from_utf8_lossy(&output.stdout).to_string();
    let cleaned = clean_model_title(&raw);
    if cleaned.is_empty() {
        eprintln!("[codex_title] haiku_empty_response raw={}", raw.trim());
        return Err("Claude CLI returned an empty title".to_string());
    }

    let final_title = enforce_max_chars(&cleaned, max_chars);
    if !is_viable_title(&final_title) {
        eprintln!(
            "[codex_title] haiku_invalid_response raw={} cleaned={}",
            raw.trim(),
            final_title
        );
        return Err("Claude CLI returned an invalid title".to_string());
    }
    eprintln!("[codex_title] haiku_response title={}", final_title);
    Ok(final_title)
}

fn build_haiku_command(project_path: &str) -> Command {
    #[cfg(windows)]
    {
        let mut cmd = Command::new("cmd.exe");
        cmd.args([
            "/c",
            "claude",
            "-p",
            "--no-session-persistence",
            "--model",
            TITLE_MODEL,
        ])
        .current_dir(project_path)
        .creation_flags(CREATE_NO_WINDOW);
        return cmd;
    }

    #[cfg(not(windows))]
    {
        let mut cmd = Command::new("claude");
        cmd.args(["-p", "--no-session-persistence", "--model", TITLE_MODEL])
            .current_dir(project_path);
        cmd
    }
}

fn build_title_generation_prompt(prompts_newest_first: &[String], max_chars: usize) -> String {
    let header = format!(
        "Generate a brief terminal tab title for this user prompt. \
Rules: output ONLY the title, no quotes, no prefixes, no explanation. \
Use 2-5 words. Maximum {} characters.\n\nUser prompt: ",
        max_chars
    );
    let primary_prompt = prompts_newest_first
        .first()
        .map(|p| enforce_max_chars(p, MAX_HAIKU_USER_PROMPT_CHARS))
        .unwrap_or_default();
    format!("{}{}", header, primary_prompt)
}

fn sanitize_user_prompt_for_title(input: &str) -> Option<String> {
    let clean = collapse_whitespace(input);
    if clean.is_empty() {
        return None;
    }

    let lower = clean.to_ascii_lowercase();
    let is_noise = lower.starts_with("<environment_context>")
        || lower.starts_with("<turn_aborted>")
        || lower.starts_with("<permissions instructions>")
        || lower.starts_with("# agents.md instructions")
        || lower.contains("<instructions>");
    if is_noise {
        return None;
    }

    if clean.starts_with('<') && clean.ends_with('>') && clean.contains("</") {
        return None;
    }

    Some(clean)
}

fn is_viable_title(input: &str) -> bool {
    let s = input.trim();
    if s.chars().count() < 2 {
        return false;
    }
    s.chars().any(|c| c.is_ascii_alphanumeric())
}

fn deterministic_title_from_prompts(prompts_newest_first: &[String], max_chars: usize) -> Option<String> {
    let mut combined = String::new();

    for prompt in prompts_newest_first {
        let clean = collapse_whitespace(prompt);
        if clean.is_empty() {
            continue;
        }
        if !combined.is_empty() {
            combined.push(' ');
        }
        combined.push_str(&clean);
        if combined.chars().count() >= max_chars * 3 {
            break;
        }
    }

    if combined.is_empty() {
        None
    } else {
        Some(enforce_max_chars(&combined, max_chars))
    }
}

fn clean_model_title(raw: &str) -> String {
    let first_non_empty_line = raw
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or(raw.trim());

    let mut clean = collapse_whitespace(first_non_empty_line);
    clean = strip_wrapping_quotes(&clean);

    while matches!(clean.chars().last(), Some('.') | Some(':') | Some(';')) {
        clean.pop();
        clean = clean.trim_end().to_string();
    }

    clean
}

fn strip_wrapping_quotes(input: &str) -> String {
    let mut out = input.trim().to_string();
    loop {
        let starts = out.chars().next();
        let ends = out.chars().last();
        let wrapped = matches!(
            (starts, ends),
            (Some('"'), Some('"'))
                | (Some('\''), Some('\''))
                | (Some('`'), Some('`'))
        );
        if wrapped && out.chars().count() >= 2 {
            out = out
                .chars()
                .skip(1)
                .take(out.chars().count().saturating_sub(2))
                .collect::<String>()
                .trim()
                .to_string();
            continue;
        }
        break;
    }
    out
}

fn collapse_whitespace(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut in_ws = false;

    for ch in input.chars() {
        let is_ws = ch.is_whitespace() || ch.is_control();
        if is_ws {
            if !in_ws {
                out.push(' ');
                in_ws = true;
            }
        } else {
            out.push(ch);
            in_ws = false;
        }
    }

    out.trim().to_string()
}

fn enforce_max_chars(input: &str, max_chars: usize) -> String {
    let clean = collapse_whitespace(input);
    let count = clean.chars().count();
    if count <= max_chars {
        return clean;
    }

    if max_chars <= 3 {
        return clean.chars().take(max_chars).collect();
    }

    let mut truncated: String = clean.chars().take(max_chars - 3).collect();
    truncated = truncated.trim_end().to_string();
    truncated.push_str("...");
    truncated
}

fn normalize_compare_path(path: &str) -> String {
    let mut normalized = path.trim().replace('\\', "/");
    while normalized.ends_with('/') {
        normalized.pop();
    }
    #[cfg(windows)]
    {
        normalized = normalized.to_ascii_lowercase();
    }
    normalized
}
