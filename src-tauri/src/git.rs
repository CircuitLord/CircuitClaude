use crate::remote::{self, CmdOutput, Location};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::io::Write;
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::{Command, Stdio};

const CREATE_NO_WINDOW: u32 = 0x08000000;

/// Runs git in the project, locally or over ssh depending on the project path.
fn run_git(project_path: &str, args: &[&str]) -> Result<CmdOutput, String> {
    match remote::locate(project_path) {
        Location::Local(path) => remote::run_local(&path, "git", args),
        Location::Remote(target) => {
            remote::run(&target, Some(&target.path), &remote::shell_cmd("git", args))
        }
    }
}

fn read_project_text(project_path: &str, rel_path: &str) -> Result<String, String> {
    match remote::locate(project_path) {
        Location::Local(base) => fs::read_to_string(std::path::Path::new(&base).join(rel_path))
            .map_err(|e| format!("Failed to read file: {}", e)),
        Location::Remote(target) => {
            remote::read_text(&target, &remote::join_path(&target.path, rel_path))
        }
    }
}

/// Resolves the full path to the `claude` executable.
/// Checks known install locations since the Tauri process may not inherit
/// the same PATH as the user's shell (where PTY sessions work fine).
pub(crate) fn find_claude_exe() -> Result<PathBuf, String> {
    // Check PATH first via `where`
    if let Ok(output) = Command::new("cmd.exe")
        .args(["/c", "where", "claude"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
    {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            if let Some(first_line) = stdout.lines().next() {
                let p = PathBuf::from(first_line.trim());
                if p.exists() {
                    return Ok(p);
                }
            }
        }
    }

    // Check known install locations
    if let Some(home) = std::env::var_os("USERPROFILE") {
        let candidates = [
            PathBuf::from(&home).join(".local/bin/claude.exe"),
            PathBuf::from(&home).join(".local/bin/claude.cmd"),
        ];
        for c in &candidates {
            if c.exists() {
                return Ok(c.clone());
            }
        }
    }
    if let Some(appdata) = std::env::var_os("APPDATA") {
        let c = PathBuf::from(appdata).join("npm/claude.cmd");
        if c.exists() {
            return Ok(c);
        }
    }

    Err("Could not find claude CLI. Ensure it is installed and in PATH.".to_string())
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitFileEntry {
    pub path: String,
    pub status: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub is_repo: bool,
    pub branch: String,
    pub files: Vec<GitFileEntry>,
}

pub fn get_status(project_path: &str) -> GitStatus {
    let branch = match run_git(project_path, &["rev-parse", "--abbrev-ref", "HEAD"]) {
        Ok(output) if output.ok => output.stdout.trim().to_string(),
        _ => {
            return GitStatus {
                is_repo: false,
                branch: String::new(),
                files: Vec::new(),
            };
        }
    };

    let mut files = match run_git(project_path, &["status", "--porcelain=v1", "-uall"]) {
        Ok(output) if output.ok => parse_porcelain(&output.stdout),
        _ => Vec::new(),
    };

    mark_nested_repos(project_path, &mut files);

    GitStatus {
        is_repo: true,
        branch,
        files,
    }
}

/// Untracked entries that are themselves git repos get their own status marker.
fn mark_nested_repos(project_path: &str, files: &mut [GitFileEntry]) {
    let untracked: Vec<String> = files
        .iter()
        .filter(|f| f.status == "?")
        .map(|f| f.path.clone())
        .collect();
    if untracked.is_empty() {
        return;
    }

    let nested: HashSet<String> = match remote::locate(project_path) {
        Location::Local(base) => {
            let base = std::path::Path::new(&base);
            untracked
                .into_iter()
                .filter(|p| base.join(p).join(".git").exists())
                .collect()
        }
        Location::Remote(target) => {
            let list: Vec<String> = untracked.iter().map(|p| remote::q(p)).collect();
            let command = format!(
                "for p in {}; do [ -d \"$p/.git\" ] && printf '%s\\n' \"$p\"; done",
                list.join(" ")
            );
            match remote::run(&target, Some(&target.path), &command) {
                Ok(output) => output
                    .stdout
                    .lines()
                    .map(|l| l.trim().to_string())
                    .filter(|l| !l.is_empty())
                    .collect(),
                Err(_) => HashSet::new(),
            }
        }
    };

    for f in files.iter_mut() {
        if f.status == "?" && nested.contains(&f.path) {
            f.status = "S".to_string();
        }
    }
}

pub fn get_diff(project_path: &str, file_path: &str, status: &str) -> Result<String, String> {
    if status == "?" {
        // Untracked file: read contents and format as synthetic diff
        let contents = read_project_text(project_path, file_path)?;
        let lines: Vec<&str> = contents.lines().collect();
        let line_count = lines.len();
        let mut diff = format!(
            "--- /dev/null\n+++ b/{}\n@@ -0,0 +1,{} @@\n",
            file_path, line_count
        );
        for line in lines {
            diff.push('+');
            diff.push_str(line);
            diff.push('\n');
        }
        return Ok(diff);
    }

    let output = run_git(project_path, &["diff", "HEAD", "--", file_path])?;
    if !output.ok {
        return Err(format!("git diff failed: {}", output.err_text()));
    }
    Ok(output.stdout)
}

pub fn commit(project_path: &str, files: &[String], message: &str) -> Result<String, String> {
    // Stage selected files
    let mut add_args = vec!["add", "--"];
    let file_refs: Vec<&str> = files.iter().map(|s| s.as_str()).collect();
    add_args.extend(file_refs);

    let add_output = run_git(project_path, &add_args)?;
    if !add_output.ok {
        return Err(format!("git add failed: {}", add_output.err_text()));
    }

    let commit_output = run_git(project_path, &["commit", "-m", message])?;
    if !commit_output.ok {
        return Err(format!("git commit failed: {}", commit_output.err_text()));
    }

    Ok(commit_output.stdout.trim().to_string())
}

pub fn revert(project_path: &str, files: &[GitFileEntry]) -> Result<(), String> {
    let mut untracked: Vec<&str> = Vec::new();
    let mut added: Vec<&str> = Vec::new();
    let mut tracked: Vec<&str> = Vec::new();

    for f in files {
        match f.status.as_str() {
            "?" => untracked.push(&f.path),
            "A" => added.push(&f.path),
            _ => tracked.push(&f.path),
        }
    }

    // Revert untracked: git clean -f -- <paths>
    if !untracked.is_empty() {
        let mut args: Vec<&str> = vec!["clean", "-f", "--"];
        args.extend(&untracked);
        let output = run_git(project_path, &args)?;
        if !output.ok {
            return Err(format!("git clean failed: {}", output.err_text()));
        }
    }

    // Revert added: git rm -f -- <paths>
    if !added.is_empty() {
        let mut args: Vec<&str> = vec!["rm", "-f", "--"];
        args.extend(&added);
        let output = run_git(project_path, &args)?;
        if !output.ok {
            return Err(format!("git rm failed: {}", output.err_text()));
        }
    }

    // Revert tracked (M, D, R, etc.): git checkout HEAD -- <paths>
    if !tracked.is_empty() {
        let mut args: Vec<&str> = vec!["checkout", "HEAD", "--"];
        args.extend(&tracked);
        let output = run_git(project_path, &args)?;
        if !output.ok {
            return Err(format!("git checkout failed: {}", output.err_text()));
        }
    }

    Ok(())
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DiffStat {
    pub path: String,
    pub insertions: u32,
    pub deletions: u32,
}

pub fn get_diff_stats(project_path: &str, files: &[GitFileEntry]) -> Result<Vec<DiffStat>, String> {
    let mut tracked_paths: Vec<&str> = Vec::new();
    let mut untracked: Vec<&str> = Vec::new();

    for f in files {
        if f.status == "?" {
            untracked.push(&f.path);
        } else {
            tracked_paths.push(&f.path);
        }
    }

    let mut stats: Vec<DiffStat> = Vec::new();

    // Tracked files: git diff HEAD --numstat -- <paths>
    if !tracked_paths.is_empty() {
        let mut args: Vec<&str> = vec!["diff", "HEAD", "--numstat", "--"];
        args.extend(&tracked_paths);
        if let Ok(output) = run_git(project_path, &args) {
            if output.ok {
                stats.extend(parse_numstat(&output.stdout));
            }
        }
    }

    // Untracked files: count lines as insertions
    stats.extend(count_lines(project_path, &untracked));

    Ok(stats)
}

fn count_lines(project_path: &str, paths: &[&str]) -> Vec<DiffStat> {
    if paths.is_empty() {
        return Vec::new();
    }

    match remote::locate(project_path) {
        Location::Local(base) => paths
            .iter()
            .map(|path| {
                let insertions = fs::read_to_string(std::path::Path::new(&base).join(path))
                    .map(|c| c.lines().count() as u32)
                    .unwrap_or(0);
                DiffStat {
                    path: path.to_string(),
                    insertions,
                    deletions: 0,
                }
            })
            .collect(),
        Location::Remote(target) => {
            let quoted: Vec<String> = paths.iter().map(|p| remote::q(p)).collect();
            let command = format!("wc -l -- {}", quoted.join(" "));
            let output = match remote::run(&target, Some(&target.path), &command) {
                Ok(output) => output.stdout,
                Err(_) => String::new(),
            };
            // "  12 src/a.ts" per file, plus a "total" line when there are several
            let wanted: HashSet<&str> = paths.iter().copied().collect();
            let mut counts: Vec<DiffStat> = Vec::new();
            for line in output.lines() {
                let trimmed = line.trim_start();
                let Some((count, path)) = trimmed.split_once(' ') else {
                    continue;
                };
                let path = path.trim();
                if !wanted.contains(path) {
                    continue;
                }
                counts.push(DiffStat {
                    path: path.to_string(),
                    insertions: count.parse().unwrap_or(0),
                    deletions: 0,
                });
            }
            counts
        }
    }
}

pub fn push(project_path: &str) -> Result<String, String> {
    let output = run_git(project_path, &["push"])?;
    if !output.ok {
        return Err(format!("git push failed: {}", output.err_text()));
    }

    let stdout = output.stdout.trim().to_string();
    let stderr = output.stderr.trim().to_string();
    // git push often writes progress to stderr even on success
    Ok(if stdout.is_empty() { stderr } else { stdout })
}

const MAX_DIFF_CHARS: usize = 100_000;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GenerateResult {
    pub prompt: String,
    pub message: String,
    pub model: String,
}

pub fn generate_commit_message(
    project_path: &str,
    files: &[GitFileEntry],
) -> Result<GenerateResult, String> {
    // Collect combined diffs from all selected files
    let mut combined_diff = String::new();
    for f in files {
        match get_diff(project_path, &f.path, &f.status) {
            Ok(diff) => {
                combined_diff.push_str(&diff);
                combined_diff.push('\n');
                if combined_diff.len() > MAX_DIFF_CHARS {
                    combined_diff.truncate(MAX_DIFF_CHARS);
                    combined_diff.push_str("\n... (truncated)\n");
                    break;
                }
            }
            Err(_) => continue,
        }
    }

    if combined_diff.trim().is_empty() {
        return Err("No diff content to generate a message from".to_string());
    }

    let prompt = format!(
        "Generate a git commit message for this diff. \
         Rules: output ONLY the message, no quotes, no prefixes, no explanation. \
         Imperative mood (\"Add\" not \"Added\"). First line under 72 chars. \
         After the first line, add a blank line then a few bullet points (using \"-\") \
         covering only the important changes. Skip trivial stuff like whitespace, \
         imports, or minor rewording. Keep each bullet to one short line.\n\n{}",
        combined_diff
    );

    let model = "claude-haiku-4-5-20251001";

    let claude_path = find_claude_exe()?;

    // the CLI runs on this machine even for remote projects, so fall back to home
    let cwd = match remote::locate(project_path) {
        Location::Local(path) => PathBuf::from(path),
        Location::Remote(_) => dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")),
    };

    let mut child = Command::new(&claude_path)
        .args(["-p", "--no-session-persistence", "--model", model])
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|e| format!("Failed to launch Claude CLI: {}", e))?;

    {
        let mut stdin: std::process::ChildStdin = child
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
        return Err(format!(
            "Claude CLI failed (exit {}): {}",
            output.status, detail
        ));
    }

    let message = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if message.is_empty() {
        return Err("Claude CLI returned an empty response".to_string());
    }

    Ok(GenerateResult {
        prompt,
        message,
        model: model.to_string(),
    })
}

fn parse_numstat(output: &str) -> Vec<DiffStat> {
    let mut stats = Vec::new();
    for line in output.lines() {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() >= 3 {
            stats.push(DiffStat {
                // Binary files output "-" for counts
                insertions: parts[0].parse::<u32>().unwrap_or(0),
                deletions: parts[1].parse::<u32>().unwrap_or(0),
                path: parts[2].to_string(),
            });
        }
    }
    stats
}

fn parse_porcelain(output: &str) -> Vec<GitFileEntry> {
    let mut files = Vec::new();

    for line in output.lines() {
        if line.len() < 4 {
            continue;
        }

        let index_status = line.as_bytes()[0] as char;
        let worktree_status = line.as_bytes()[1] as char;
        let path = line[3..].to_string();

        // Strip quotes that git adds around paths with spaces or special chars
        let path = if path.starts_with('"') && path.ends_with('"') {
            path[1..path.len() - 1].to_string()
        } else {
            path
        };

        // Strip trailing slash from directory entries (e.g. nested git repos)
        let path = path.trim_end_matches('/').to_string();

        // Handle renames: "R  old -> new"
        let path = if let Some(pos) = path.find(" -> ") {
            let new_path = path[pos + 4..].to_string();
            // The new path portion may also be quoted
            if new_path.starts_with('"') && new_path.ends_with('"') {
                new_path[1..new_path.len() - 1].to_string()
            } else {
                new_path
            }
        } else {
            path
        };

        // One entry per file — prefer index status if present, else worktree status
        let status = if index_status != ' ' && index_status != '?' {
            index_status.to_string()
        } else if worktree_status != ' ' {
            if index_status == '?' {
                "?".to_string()
            } else {
                worktree_status.to_string()
            }
        } else {
            continue;
        };

        files.push(GitFileEntry { path, status });
    }

    files
}
