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

export function readAgentsMd(projectPath?: string): Promise<{ path: string; content: string }> {
  return invoke<{ path: string; content: string }>("read_agents_md", { projectPath: projectPath ?? null });
}

export function saveAgentsMd(projectPath: string | undefined, content: string): Promise<void> {
  return invoke("save_agents_md", { projectPath: projectPath ?? null, content });
}

export function loadNote(projectPath: string): Promise<string> {
  return invoke<string>("load_note", { projectPath });
}

export function saveNote(projectPath: string, content: string): Promise<void> {
  return invoke("save_note", { projectPath, content });
}
