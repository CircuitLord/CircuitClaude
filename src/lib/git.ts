import { invoke } from "@tauri-apps/api/core";
import { DiffStat, GenerateResult, GitFileEntry, GitStatus } from "../types";

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

export function getGitDiffStats(projectPath: string, files: GitFileEntry[]): Promise<DiffStat[]> {
  return invoke<DiffStat[]>("get_git_diff_stats", { projectPath, files });
}

export function gitPush(projectPath: string): Promise<string> {
  return invoke<string>("git_push", { projectPath });
}

export function generateCommitMessage(projectPath: string, files: GitFileEntry[]): Promise<GenerateResult> {
  return invoke<GenerateResult>("generate_commit_message", { projectPath, files });
}
