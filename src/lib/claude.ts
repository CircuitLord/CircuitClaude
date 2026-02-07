import { invoke, Channel } from "@tauri-apps/api/core";
import type { ClaudeEvent } from "../types";

export function createClaudeSession(
  projectPath: string,
  onEvent: Channel<ClaudeEvent>,
): Promise<string> {
  return invoke<string>("create_claude_session", {
    projectPath,
    onEvent,
  });
}

export function sendClaudeMessage(
  tabId: string,
  message: string,
  permissionMode?: string,
): Promise<void> {
  return invoke("send_claude_message", {
    tabId,
    message,
    permissionMode: permissionMode ?? null,
  });
}

export function respondToPermission(
  tabId: string,
  id: string,
  allowed: boolean,
  message?: string,
): Promise<void> {
  return invoke("respond_to_permission", {
    tabId,
    id,
    allowed,
    message: message ?? null,
  });
}

export function respondToQuestion(
  tabId: string,
  id: string,
  answers: Record<string, string>,
): Promise<void> {
  return invoke("respond_to_question", {
    tabId,
    id,
    answers,
  });
}

export function interruptClaudeSession(tabId: string): Promise<void> {
  return invoke("interrupt_claude_session", { tabId });
}

export function destroyClaudeSession(tabId: string): Promise<void> {
  return invoke("destroy_claude_session", { tabId });
}
