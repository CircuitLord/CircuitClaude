import { invoke } from "@tauri-apps/api/core";
import { Project, Settings } from "../types";

export function loadProjects(): Promise<Project[]> {
  return invoke<Project[]>("load_projects");
}

export function saveProjects(projects: Project[]): Promise<void> {
  return invoke("save_projects", { projects });
}

export function loadSettings(): Promise<Settings | null> {
  return invoke<Settings | null>("load_settings");
}

export function saveSettings(settings: Settings): Promise<void> {
  return invoke("save_settings", { settings });
}

export function readClaudeMd(projectPath?: string): Promise<{ path: string; content: string }> {
  return invoke<{ path: string; content: string }>("read_claude_md", { projectPath: projectPath ?? null });
}

export function saveClaudeMd(projectPath: string | undefined, content: string): Promise<void> {
  return invoke("save_claude_md", { projectPath: projectPath ?? null, content });
}
