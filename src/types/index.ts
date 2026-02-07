export interface Project {
  name: string;
  path: string;
  theme: ThemeName;
}

export interface TerminalSession {
  id: string;
  projectName: string;
  projectPath: string;
  sessionId: string | null; // PTY session ID from Rust (shell sessions only)
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
  status: string; // "M", "A", "D", "R", "?", "S" (subrepo)
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

// --- Claude Event types (from Rust claude_manager) ---

export interface ModelUsage {
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  context_window: number;
}

export interface SessionStats {
  model: string;
  permissionMode: string;
  toolCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  contextWindow: number;
  turns: number;
  durationMs: number;
}

export interface ClaudeTextEvent { type: "Text"; data: { text: string } }
export interface ClaudeThinkingEvent { type: "Thinking"; data: { text: string } }
export interface ClaudeToolUseEvent { type: "ToolUse"; data: { id: string; name: string; input: unknown } }
export interface ClaudeToolResultEvent { type: "ToolResult"; data: { tool_use_id: string; content: string; is_error: boolean } }
export interface ClaudeResultEvent { type: "Result"; data: { subtype: string; duration_ms: number; is_error: boolean; num_turns: number; session_id: string; model_usage: ModelUsage | null } }
export interface ClaudeErrorEvent { type: "Error"; data: { message: string } }
export interface ClaudeMessageStartEvent { type: "MessageStart"; data: null }
export interface ClaudeMessageStopEvent { type: "MessageStop"; data: null }
export interface ClaudePermissionRequestEvent { type: "PermissionRequest"; data: { id: string; tool: string; input: unknown; description: string } }
export interface ClaudeUserQuestionEvent { type: "UserQuestion"; data: { id: string; questions: UserQuestionItem[] } }
export interface ClaudeReadyEvent { type: "Ready"; data: null }
export interface ClaudeSystemEvent { type: "System"; data: { session_id: string; model: string; permission_mode: string; tool_count: number } }

export type ClaudeEvent =
  | ClaudeTextEvent
  | ClaudeThinkingEvent
  | ClaudeToolUseEvent
  | ClaudeToolResultEvent
  | ClaudeResultEvent
  | ClaudeErrorEvent
  | ClaudeMessageStartEvent
  | ClaudeMessageStopEvent
  | ClaudePermissionRequestEvent
  | ClaudeUserQuestionEvent
  | ClaudeReadyEvent
  | ClaudeSystemEvent;

// --- User question types ---

export interface UserQuestionOption {
  label: string;
  description: string;
}

export interface UserQuestionItem {
  question: string;
  header?: string;
  options?: UserQuestionOption[];
  multiSelect?: boolean;
}

// --- Conversation model for display ---

export type PermissionStatus = "pending" | "allowed" | "denied" | "auto_approved";
export type QuestionStatus = "pending" | "answered";

export interface ConversationBlock {
  type: "text" | "thinking" | "tool_use" | "tool_result" | "error" | "permission_request" | "user_question";
  content: string;
  toolName?: string;
  toolInput?: unknown;
  toolUseId?: string;
  isError?: boolean;
  // Permission request fields
  permissionId?: string;
  permissionTool?: string;
  permissionDescription?: string;
  permissionStatus?: PermissionStatus;
  // User question fields
  questionId?: string;
  questions?: UserQuestionItem[];
  questionStatus?: QuestionStatus;
  answers?: Record<string, string>;
}

export interface ConversationMessage {
  id: string;
  role: "user" | "assistant";
  blocks: ConversationBlock[];
  timestamp: number;
  streaming?: boolean;
}

// --- Settings ---

export interface Settings {
  theme: ThemeName;
  syntaxTheme: SyntaxThemeName;
  terminalFontSize: number;
  terminalFontFamily: string;
  gitViewMode: "file" | "tree";
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "midnight",
  syntaxTheme: "github-dark",
  terminalFontSize: 15,
  terminalFontFamily: "'Cascadia Code', 'Consolas', 'Monaco', monospace",
  gitViewMode: "file",
};
