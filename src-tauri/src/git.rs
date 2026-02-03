use serde::Serialize;
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
