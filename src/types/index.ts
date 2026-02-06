export interface Project {
  name: string;
  path: string;
  theme: ThemeName;
}

export interface TerminalSession {
  id: string;
  projectName: string;
  projectPath: string;
  sessionId: string | null; // PTY session ID from Rust
  claudeSessionId?: string; // UUID passed to Claude CLI via --session-id / --resume
  createdAt: number;
  restored?: boolean;
  hasInteracted?: boolean;
  restorePending?: boolean;
  isShell?: boolean; // Plain terminal (no Claude)
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

export interface DiffStat {
  path: string;
  insertions: number;
  deletions: number;
}

export interface GenerateResult {
  prompt: string;
  message: string;
  model: string;
}

export type ThemeName = "midnight" | "ember" | "arctic" | "forest" | "crimson" | "sakura" | "amber";

export type SyntaxThemeName = "github-dark" | "monokai" | "tokyo-night";

export type LayoutMode = "grid" | "tabs";

export interface Settings {
  theme: ThemeName;
  syntaxTheme: SyntaxThemeName;
  layoutMode: LayoutMode;
  terminalFontSize: number;
  terminalFontFamily: string;
  terminalCursorStyle: "bar" | "block" | "underline";
  terminalCursorBlink: boolean;
  gitViewMode: "file" | "tree";
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "midnight",
  syntaxTheme: "github-dark",
  layoutMode: "grid",
  terminalFontSize: 15,
  terminalFontFamily: "'Cascadia Code', 'Consolas', 'Monaco', monospace",
  terminalCursorStyle: "bar",
  terminalCursorBlink: true,
  gitViewMode: "file",
};
