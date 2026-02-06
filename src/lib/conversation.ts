import { invoke } from "@tauri-apps/api/core";

export interface ConversationMessage {
  uuid: string;
  role: "human" | "assistant";
  text: string;
  timestamp: string;
}

export interface ConversationResponse {
  messages: ConversationMessage[];
  lastModified: number;
}

export function readConversation(
  projectPath: string,
  sessionId?: string,
): Promise<ConversationResponse> {
  return invoke<ConversationResponse>("read_conversation", {
    projectPath,
    sessionId: sessionId ?? null,
  });
}

export function getConversationMtime(
  projectPath: string,
  sessionId?: string,
): Promise<number | null> {
  return invoke<number | null>("get_conversation_mtime", {
    projectPath,
    sessionId: sessionId ?? null,
  });
}
