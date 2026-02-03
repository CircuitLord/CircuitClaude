use serde::Serialize;
use std::fs;
use std::process::Command;

#[derive(Serialize, Clone)]
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
