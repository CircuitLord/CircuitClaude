import { invoke } from "@tauri-apps/api/core";
import { Project, SessionsConfig, Settings } from "../types";

export function loadProjects(): Promise<Project[]> {
  return invoke<Project[]>("load_projects");
}

export function saveProjects(projects: Project[]): Promise<void> {
  return invoke("save_projects", { projects });
}

export function loadSessionsConfig(): Promise<SessionsConfig | null> {
  return invoke<SessionsConfig | null>("load_sessions_config");
}

export function saveSessionsConfig(config: SessionsConfig): Promise<void> {
  return invoke("save_sessions_config", { config });
}

export function saveScrollback(tabId: string, data: string): Promise<void> {
  return invoke("save_scrollback", { tabId, data });
}

export function loadScrollback(tabId: string): Promise<string> {
  return invoke<string>("load_scrollback", { tabId });
}

export function deleteScrollback(tabId: string): Promise<void> {
  return invoke("delete_scrollback", { tabId });
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
