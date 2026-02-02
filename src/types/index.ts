export interface Project {
  name: string;
  path: string;
}

export interface TerminalSession {
  id: string;
  projectName: string;
  projectPath: string;
  sessionId: string | null; // PTY session ID from Rust
}

export interface PtyOutputEvent {
  type: "Data" | "Exit";
  data: number[] | number | null;
}
