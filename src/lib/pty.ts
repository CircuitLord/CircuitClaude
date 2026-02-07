import { invoke, Channel } from "@tauri-apps/api/core";
import { PtyOutputEvent } from "../types";

export function spawnSession(
  projectPath: string,
  cols: number,
  rows: number,
  onOutput: Channel<PtyOutputEvent>,
  options?: {
    claudeSessionId?: string;
    resumeSessionId?: string;
    continueSession?: boolean;
  }
): Promise<string> {
  return invoke<string>("spawn_session", {
    projectPath,
    cols,
    rows,
    claudeSessionId: options?.claudeSessionId ?? null,
    resumeSessionId: options?.resumeSessionId ?? null,
    continueSession: options?.continueSession ?? false,
    onOutput,
  });
}

export function spawnShell(
  projectPath: string,
  cols: number,
  rows: number,
  onOutput: Channel<PtyOutputEvent>,
): Promise<string> {
  return invoke<string>("spawn_shell", {
    projectPath,
    cols,
    rows,
    onOutput,
  });
}

export function spawnOpencode(
  projectPath: string,
  cols: number,
  rows: number,
  onOutput: Channel<PtyOutputEvent>,
  options?: { continueSession?: boolean },
): Promise<string> {
  return invoke<string>("spawn_opencode", {
    projectPath,
    cols,
    rows,
    continueSession: options?.continueSession ?? false,
    onOutput,
  });
}

export function writeSession(
  sessionId: string,
  data: Uint8Array
): Promise<void> {
  return invoke("write_session", {
    sessionId,
    data: Array.from(data),
  });
}

export function resizeSession(
  sessionId: string,
  cols: number,
  rows: number
): Promise<void> {
  return invoke("resize_session", { sessionId, cols, rows });
}

export function killSession(sessionId: string): Promise<void> {
  return invoke("kill_session", { sessionId });
}

export function killAllSessions(): Promise<void> {
  return invoke("kill_all_sessions");
}

export function exitApp(): Promise<void> {
  return invoke("exit_app");
}
