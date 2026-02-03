import { invoke } from "@tauri-apps/api/core";
import { GitStatus } from "../types";

export function getGitStatus(projectPath: string): Promise<GitStatus> {
  return invoke<GitStatus>("get_git_status", { projectPath });
}

export function getGitDiff(projectPath: string, filePath: string, staged: boolean, status: string): Promise<string> {
  return invoke<string>("get_git_diff", { projectPath, filePath, staged, status });
}
