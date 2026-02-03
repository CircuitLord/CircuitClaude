export interface Project {
  name: string;
  path: string;
}

export interface TerminalSession {
  id: string;
  projectName: string;
  projectPath: string;
  sessionId: string | null; // PTY session ID from Rust
  createdAt: number;
  restored?: boolean;
}

export interface PersistedSession {
  id: string;
  projectName: string;
  projectPath: string;
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
