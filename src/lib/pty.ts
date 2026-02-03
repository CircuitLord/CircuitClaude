import { invoke, Channel } from "@tauri-apps/api/core";
import { PtyOutputEvent } from "../types";

export function spawnSession(
  projectPath: string,
  cols: number,
  rows: number,
  onOutput: Channel<PtyOutputEvent>,
  continueSession: boolean = false
): Promise<string> {
  return invoke<string>("spawn_session", {
    projectPath,
    cols,
    rows,
    continueSession,
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
