import { invoke, Channel } from "@tauri-apps/api/core";
import { PtyOutputEvent } from "../types";

export interface CreatePtySessionRequest {
  projectPath: string;
  cols: number;
  rows: number;
  sessionType: string;
  claudeSessionId?: string;
  resumeSessionId?: string;
  continueSession?: boolean;
  command?: string;
}

export interface CreatePtySessionResponse {
  sessionId: string;
}

export interface AttachPtySessionStreamResponse {
  subscriberId: string;
  lastSeq: number;
}

export interface PtySessionInfo {
  sessionId: string;
  sessionType: string;
  state: "running" | "exited" | "closing" | "closed";
  subscribers: number;
  startedAtMs: number;
  lastSeq: number;
  lastExitCode: number | null;
}

export function createPtySession(
  request: CreatePtySessionRequest,
): Promise<CreatePtySessionResponse> {
  return invoke<CreatePtySessionResponse>("create_pty_session", { request });
}

export function attachPtySessionStream(
  sessionId: string,
  onOutput: Channel<PtyOutputEvent>,
  replayFromSeq?: number | null,
): Promise<AttachPtySessionStreamResponse> {
  return invoke<AttachPtySessionStreamResponse>("attach_pty_session_stream", {
    sessionId,
    replayFromSeq: replayFromSeq ?? null,
    onOutput,
  });
}

export function detachPtySessionStream(
  sessionId: string,
  subscriberId: string,
): Promise<void> {
  return invoke("detach_pty_session_stream", { sessionId, subscriberId });
}

export function writePtySession(sessionId: string, data: Uint8Array): Promise<void> {
  return invoke("write_pty_session", {
    sessionId,
    data: Array.from(data),
  });
}

export function resizePtySession(
  sessionId: string,
  cols: number,
  rows: number,
): Promise<void> {
  return invoke("resize_pty_session", { sessionId, cols, rows });
}

export function closePtySession(sessionId: string): Promise<void> {
  return invoke("close_pty_session", { sessionId });
}

export function closeAllPtySessions(): Promise<void> {
  return invoke("close_all_pty_sessions");
}

export function getPtySessionInfo(sessionId: string): Promise<PtySessionInfo> {
  return invoke<PtySessionInfo>("get_pty_session_info", { sessionId });
}

export function saveClipboardImage(data: number[], mimeType: string): Promise<string> {
  return invoke<string>("save_clipboard_image", { data, mimeType });
}

export function exitApp(): Promise<void> {
  return invoke("exit_app");
}
