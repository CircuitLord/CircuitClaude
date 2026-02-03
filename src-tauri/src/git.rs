use serde::{Deserialize, Serialize};
use std::fs;
use std::process::Command;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitFileEntry {
    pub path: String,
    pub status: String,
    pub staged: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub is_repo: bool,
    pub branch: String,
    pub files: Vec<GitFileEntry>,
}

pub fn get_status(project_path: &str) -> GitStatus {
    let branch = match Command::new("git")
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(project_path)
        .output()
    {
        Ok(output) if output.status.success() => {
            String::from_utf8_lossy(&output.stdout).trim().to_string()
        }
        _ => {
            return GitStatus {
                is_repo: false,
                branch: String::new(),
                files: Vec::new(),
            };
        }
    };

    let files = match Command::new("git")
        .args(["status", "--porcelain=v1"])
        .current_dir(project_path)
        .output()
    {
        Ok(output) if output.status.success() => {
            parse_porcelain(&String::from_utf8_lossy(&output.stdout))
        }
        _ => Vec::new(),
    };

    GitStatus {
        is_repo: true,
        branch,
        files,
    }
}

pub fn get_diff(project_path: &str, file_path: &str, staged: bool, status: &str) -> Result<String, String> {
    if status == "?" {
        // Untracked file: read contents and format as synthetic diff
        let full_path = std::path::Path::new(project_path).join(file_path);
        let contents = fs::read_to_string(&full_path)
            .map_err(|e| format!("Failed to read file: {}", e))?;
        let lines: Vec<&str> = contents.lines().collect();
        let line_count = lines.len();
        let mut diff = format!("--- /dev/null\n+++ b/{}\n@@ -0,0 +1,{} @@\n", file_path, line_count);
        for line in lines {
            diff.push('+');
            diff.push_str(line);
            diff.push('\n');
        }
        return Ok(diff);
    }

    let mut args = vec!["diff"];
    if staged {
        args.push("--cached");
    }
    args.push("--");
    args.push(file_path);

    let output = Command::new("git")
        .args(&args)
        .current_dir(project_path)
        .output()
        .map_err(|e| format!("Failed to run git diff: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git diff failed: {}", stderr));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

pub fn commit(project_path: &str, files: &[String], message: &str) -> Result<String, String> {
    // Stage selected files
    let mut add_args = vec!["add", "--"];
    let file_refs: Vec<&str> = files.iter().map(|s| s.as_str()).collect();
    add_args.extend(file_refs);

    let add_output = Command::new("git")
        .args(&add_args)
        .current_dir(project_path)
        .output()
        .map_err(|e| format!("Failed to run git add: {}", e))?;

    if !add_output.status.success() {
        let stderr = String::from_utf8_lossy(&add_output.stderr);
        return Err(format!("git add failed: {}", stderr));
    }

    // Commit
    let commit_output = Command::new("git")
        .args(["commit", "-m", message])
        .current_dir(project_path)
        .output()
        .map_err(|e| format!("Failed to run git commit: {}", e))?;

    if !commit_output.status.success() {
        let stderr = String::from_utf8_lossy(&commit_output.stderr);
        return Err(format!("git commit failed: {}", stderr));
    }

    Ok(String::from_utf8_lossy(&commit_output.stdout).trim().to_string())
}

pub fn revert(project_path: &str, files: &[GitFileEntry]) -> Result<(), String> {
    let mut untracked: Vec<&str> = Vec::new();
    let mut staged: Vec<&str> = Vec::new();
    let mut unstaged: Vec<&str> = Vec::new();

    for f in files {
        if f.status == "?" {
            untracked.push(&f.path);
        } else if f.staged {
            staged.push(&f.path);
        } else {
            unstaged.push(&f.path);
        }
    }

    // Revert untracked: git clean -f -- <paths>
    if !untracked.is_empty() {
        let mut args: Vec<&str> = vec!["clean", "-f", "--"];
        args.extend(&untracked);
        let output = Command::new("git")
            .args(&args)
            .current_dir(project_path)
            .output()
            .map_err(|e| format!("Failed to run git clean: {}", e))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("git clean failed: {}", stderr));
        }
    }

    // Revert staged: unstage first, then restore
    if !staged.is_empty() {
        let mut unstage_args: Vec<&str> = vec!["restore", "--staged", "--"];
        unstage_args.extend(&staged);
        let output = Command::new("git")
            .args(&unstage_args)
            .current_dir(project_path)
            .output()
            .map_err(|e| format!("Failed to run git restore --staged: {}", e))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("git restore --staged failed: {}", stderr));
        }

        let mut restore_args: Vec<&str> = vec!["restore", "--"];
        restore_args.extend(&staged);
        let output = Command::new("git")
            .args(&restore_args)
            .current_dir(project_path)
            .output()
            .map_err(|e| format!("Failed to run git restore: {}", e))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("git restore failed: {}", stderr));
        }
    }

    // Revert unstaged: git restore -- <paths>
    if !unstaged.is_empty() {
        let mut args: Vec<&str> = vec!["restore", "--"];
        args.extend(&unstaged);
        let output = Command::new("git")
            .args(&args)
            .current_dir(project_path)
            .output()
            .map_err(|e| format!("Failed to run git restore: {}", e))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("git restore failed: {}", stderr));
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
    let mut staged_paths: Vec<&str> = Vec::new();
    let mut unstaged_paths: Vec<&str> = Vec::new();
    let mut untracked: Vec<&GitFileEntry> = Vec::new();

    for f in files {
        if f.status == "?" {
            untracked.push(f);
        } else if f.staged {
            staged_paths.push(&f.path);
        } else {
            unstaged_paths.push(&f.path);
        }
    }

    let mut stats: Vec<DiffStat> = Vec::new();

    // Staged files: git diff --cached --numstat -- <paths>
    if !staged_paths.is_empty() {
        let mut args: Vec<&str> = vec!["diff", "--cached", "--numstat", "--"];
        args.extend(&staged_paths);
        let output = Command::new("git")
            .args(&args)
            .current_dir(project_path)
            .output()
            .map_err(|e| format!("Failed to run git diff --cached --numstat: {}", e))?;
        if output.status.success() {
            stats.extend(parse_numstat(&String::from_utf8_lossy(&output.stdout)));
        }
    }

    // Unstaged files: git diff --numstat -- <paths>
    if !unstaged_paths.is_empty() {
        let mut args: Vec<&str> = vec!["diff", "--numstat", "--"];
        args.extend(&unstaged_paths);
        let output = Command::new("git")
            .args(&args)
            .current_dir(project_path)
            .output()
            .map_err(|e| format!("Failed to run git diff --numstat: {}", e))?;
        if output.status.success() {
            stats.extend(parse_numstat(&String::from_utf8_lossy(&output.stdout)));
        }
    }

    // Untracked files: count lines as insertions
    for f in &untracked {
        let full_path = std::path::Path::new(project_path).join(&f.path);
        let insertions = match fs::read_to_string(&full_path) {
            Ok(contents) => contents.lines().count() as u32,
            Err(_) => 0,
        };
        stats.push(DiffStat {
            path: f.path.clone(),
            insertions,
            deletions: 0,
        });
    }

    Ok(stats)
}

pub fn push(project_path: &str) -> Result<String, String> {
    let output = Command::new("git")
        .args(["push"])
        .current_dir(project_path)
        .output()
        .map_err(|e| format!("Failed to run git push: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git push failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    // git push often writes progress to stderr even on success
    Ok(if stdout.is_empty() { stderr } else { stdout })
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

        // Handle renames: "R  old -> new"
        let path = if let Some(pos) = path.find(" -> ") {
            path[pos + 4..].to_string()
        } else {
            path
        };

        // Staged entry (index has a real status)
        if index_status != ' ' && index_status != '?' {
            files.push(GitFileEntry {
                path: path.clone(),
                status: index_status.to_string(),
                staged: true,
            });
        }

        // Worktree entry (unstaged changes or untracked)
        if worktree_status != ' ' {
            let status = if index_status == '?' {
                "?".to_string()
            } else {
                worktree_status.to_string()
            };
            files.push(GitFileEntry {
                path: path.clone(),
                status,
                staged: false,
            });
        }
    }

    files
}
