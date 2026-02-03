export interface Project {
  name: string;
  path: string;
}

export interface TerminalSession {
  id: string;
  projectName: string;
  projectPath: string;
  sessionId: string | null; // PTY session ID from Rust
  claudeSessionId?: string; // UUID passed to Claude CLI via --session-id / --resume
  createdAt: number;
  restored?: boolean;
}

export interface PersistedSession {
  id: string;
  projectName: string;
  projectPath: string;
  claudeSessionId?: string;
  createdAt: number;
}

export interface ProjectSessionLayout {
  projectPath: string;
  sessions: PersistedSession[];
}

export interface SessionsConfig {
  layouts: ProjectSessionLayout[];
  activeProjectPath: string | null;
  activeSessionId: string | null;
}

export interface PtyOutputEvent {
  type: "Data" | "Exit";
  data: number[] | number | null;
}

export interface GitFileEntry {
  path: string;
  status: string; // "M", "A", "D", "R", "?"
  staged: boolean;
}

export interface GitStatus {
  isRepo: boolean;
  branch: string;
  files: GitFileEntry[];
}

export type ThemeName = "midnight" | "ember" | "arctic" | "forest" | "crimson";

export interface Settings {
  theme: ThemeName;
  terminalFontSize: number;
  terminalFontFamily: string;
  terminalCursorStyle: "bar" | "block" | "underline";
  terminalCursorBlink: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "midnight",
  terminalFontSize: 15,
  terminalFontFamily: "'Cascadia Code', 'Consolas', 'Monaco', monospace",
  terminalCursorStyle: "bar",
  terminalCursorBlink: true,
};
