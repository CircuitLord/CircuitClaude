import { invoke, Channel } from "@tauri-apps/api/core";
import type { PiRpcEvent } from "./piRpc";

export function createPiSession(
  projectPath: string,
  onEvent: Channel<PiRpcEvent>,
): Promise<string> {
  return invoke<string>("create_pi_session", {
    projectPath,
    onEvent,
  });
}

export function sendPiMessage(sessionId: string, message: string): Promise<void> {
  return invoke("send_pi_message", {
    sessionId,
    message,
  });
}

export function abortPiSession(sessionId: string): Promise<void> {
  return invoke("abort_pi_session", { sessionId });
}

export function destroyPiSession(sessionId: string): Promise<void> {
  return invoke("destroy_pi_session", { sessionId });
}
