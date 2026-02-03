import { invoke } from "@tauri-apps/api/core";
import { GitStatus } from "../types";

export function getGitStatus(projectPath: string): Promise<GitStatus> {
  return invoke<GitStatus>("get_git_status", { projectPath });
}
