export type SessionType = string;
export type ResumeStrategy = "none" | "claude" | "pi";

export interface SessionTypeConfig {
  id: string;
  name: string;
  command: string;
  resumeStrategy: ResumeStrategy;
  prefix?: string;
}

export const PI_CHAT_SESSION_TYPE: SessionTypeConfig = {
  id: "pi-chat",
  name: "pi chat",
  command: "pi",
  resumeStrategy: "pi",
  prefix: "p>",
};

export const DEFAULT_SESSION_TYPES: SessionTypeConfig[] = [
  { id: "claude", name: "claude", command: "claude", resumeStrategy: "claude", prefix: ">" },
  { id: "codex", name: "codex", command: "codex", resumeStrategy: "none", prefix: "c>" },
  { id: "terminal", name: "terminal", command: "powershell", resumeStrategy: "none", prefix: ">_" },
];

export type TabStatus = "thinking" | "waiting";

export interface Project {
  name: string;
  path: string;
  theme: ThemeName;
}

export interface PinnedFile {
  path: string;
  name: string;
  group?: string;
}

export interface TerminalSession {
  id: string;
  projectName: string;
  projectPath: string;
  sessionId: string | null;
  agentSessionId?: string;
  hasStarted?: boolean;
  isDormant?: boolean;
  resumeSession?: boolean;
  createdAt: number;
  sessionType: SessionType;
  filePath?: string;
  fileName?: string;
  isPreview?: boolean;
}

export interface PersistedSessionState {
  sessions: Array<Pick<TerminalSession, "id" | "projectName" | "projectPath" | "agentSessionId" | "hasStarted" | "createdAt" | "sessionType">>;
  sessionTitles: Record<string, string>;
}

export type PtyOutputEvent =
  | { type: "Data"; data: { seq: number; bytes: number[] } }
  | { type: "Exit"; data: { code: number | null } }
  | { type: "Closed"; data: { reason: string } }
  | { type: "Error"; data: { message: string } };

export interface GitFileEntry {
  path: string;
  status: string; // "M", "A", "D", "R", "?", "S" (subrepo)
}

export interface GitStatus {
  isRepo: boolean;
  branch: string;
  files: GitFileEntry[];
}

export interface FileTreeEntry {
  name: string;
  path: string;
  fullPath: string;
  isDir: boolean;
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

export type VoiceEngine = "whisper" | "edge";

export type SplitDirection = "horizontal" | "vertical";

export interface PaneState {
  sessionIds: string[];      // ordered list of tabs in this pane
  activeSessionId: string;   // which tab is visible in this pane
}

export interface SplitState {
  direction: SplitDirection;
  pane1: PaneState;
  pane2: PaneState;
  focusedPane: 1 | 2;
}

// --- Settings ---

export type RightPanelTab = "files" | "source" | "notes" | "pins";

export interface Settings {
  theme: ThemeName;
  syntaxTheme: SyntaxThemeName;
  terminalFontSize: number;
  terminalFontFamily: string;
  piChatFontFamily: string;
  piChatFontSize: number;
  gitViewMode: "file" | "tree";
  rightPanelTab: RightPanelTab | null;
  rightPanelWidth: number;
  voiceEngine: VoiceEngine;
  voiceMicDeviceId: string;
  whisperModel: string;
  soundEnabled: boolean;
  defaultSessionType: string;
  sessionTypes: SessionTypeConfig[];
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "midnight",
  syntaxTheme: "github-dark",
  terminalFontSize: 15,
  terminalFontFamily: "'Cascadia Code', 'Consolas', 'Monaco', monospace",
  piChatFontFamily: "'Inter', -apple-system, system-ui, sans-serif",
  piChatFontSize: 15,
  gitViewMode: "file",
  rightPanelTab: "source",
  rightPanelWidth: 350,
  voiceEngine: "edge",
  voiceMicDeviceId: "default",
  whisperModel: "medium.en",
  soundEnabled: true,
  defaultSessionType: "claude",
  sessionTypes: [...DEFAULT_SESSION_TYPES],
};
