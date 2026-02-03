import { invoke } from "@tauri-apps/api/core";
import { GitFileEntry, GitStatus } from "../types";

export function getGitStatus(projectPath: string): Promise<GitStatus> {
  return invoke<GitStatus>("get_git_status", { projectPath });
}

export function getGitDiff(projectPath: string, filePath: string, staged: boolean, status: string): Promise<string> {
  return invoke<string>("get_git_diff", { projectPath, filePath, staged, status });
}

export function gitCommit(projectPath: string, files: string[], message: string): Promise<string> {
  return invoke<string>("git_commit", { projectPath, files, message });
}

export function gitRevert(projectPath: string, files: GitFileEntry[]): Promise<void> {
  return invoke<void>("git_revert", { projectPath, files });
}
