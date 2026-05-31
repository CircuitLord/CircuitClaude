import { create } from "zustand";
import {
  extractToolCall,
  getAssistantEvent,
  getContentIndex,
  getPermissionModeFromStatus,
  normalizePiError,
  readString,
  toolSnapshotFromExecutionEvent,
  type PiPermissionMode,
  type PiRpcEvent,
  type PiToolSnapshot,
  type PiToolStatus,
} from "../lib/piRpc";

export type { PiRpcEvent } from "../lib/piRpc";

export type PiChatBlock =
  | { type: "text"; content: string; contentIndex?: number }
  | { type: "thinking"; content: string; contentIndex?: number }
  | { type: "tool"; id: string; name: string; args: unknown; output: string; status: PiToolStatus }
  | { type: "error"; content: string };

export interface PiChatMessage {
  id: string;
  role: "user" | "assistant";
  blocks: PiChatBlock[];
  timestamp: number;
  streaming?: boolean;
}

interface PiChatState {
  chats: Map<string, PiChatMessage[]>;
  streamingTabs: Set<string>;
  permissionModes: Map<string, PiPermissionMode>;
  addUserMessage: (tabId: string, text: string) => void;
  appendEvent: (tabId: string, event: PiRpcEvent) => void;
  appendError: (tabId: string, message: string) => void;
  removeChat: (tabId: string) => void;
}

function getMessages(map: Map<string, PiChatMessage[]>, tabId: string): PiChatMessage[] {
  const current = map.get(tabId);
  if (current) return current;
  const next: PiChatMessage[] = [];
  map.set(tabId, next);
  return next;
}

function ensureAssistantMessage(messages: PiChatMessage[]): PiChatMessage[] {
  const last = messages[messages.length - 1];
  if (last?.role === "assistant") {
    return last.streaming ? messages : [...messages.slice(0, -1), { ...last, streaming: true }];
  }
  return [
    ...messages,
    {
      id: crypto.randomUUID(),
      role: "assistant",
      blocks: [],
      timestamp: Date.now(),
      streaming: true,
    },
  ];
}

function updateAssistantBlocks(
  messages: PiChatMessage[],
  updater: (blocks: PiChatBlock[]) => PiChatBlock[],
): PiChatMessage[] {
  const ensured = ensureAssistantMessage(messages);
  const last = ensured[ensured.length - 1];
  if (!last || last.role !== "assistant") return ensured;
  return [...ensured.slice(0, -1), { ...last, blocks: updater(last.blocks) }];
}

function appendContent(
  messages: PiChatMessage[],
  type: "text" | "thinking",
  content: string,
  contentIndex?: number,
  mode: "append" | "replace" = "append",
): PiChatMessage[] {
  if (!content && mode === "append") return ensureAssistantMessage(messages);

  return updateAssistantBlocks(messages, (blocks) => {
    const next = [...blocks];
    const index = findContentBlockIndex(next, type, contentIndex);

    if (index === -1) {
      if (!content) return next;
      next.push({ type, content, contentIndex });
      return next;
    }

    const existing = next[index];
    if (existing.type === type) {
      next[index] = {
        ...existing,
        content: mode === "replace" ? content : existing.content + content,
      };
    }
    return next;
  });
}

function findContentBlockIndex(blocks: PiChatBlock[], type: "text" | "thinking", contentIndex?: number): number {
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const block = blocks[i];
    if (block.type !== type) continue;
    if (contentIndex === undefined || block.contentIndex === contentIndex) return i;
  }
  return -1;
}

function appendErrorBlock(messages: PiChatMessage[], content: string): PiChatMessage[] {
  return updateAssistantBlocks(messages, (blocks) => [...blocks, { type: "error", content }]);
}

function upsertTool(messages: PiChatMessage[], tool: PiToolSnapshot): PiChatMessage[] {
  return updateAssistantBlocks(messages, (blocks) => {
    const next = [...blocks];
    const id = tool.id || "tool";
    const index = next.findIndex((block) => block.type === "tool" && block.id === id);

    if (index === -1) {
      next.push({ type: "tool", ...tool, id });
      return next;
    }

    const existing = next[index];
    if (existing.type === "tool") {
      next[index] = {
        ...existing,
        name: tool.name || existing.name,
        args: tool.args ?? existing.args,
        output: tool.output || existing.output,
        status: tool.status,
      };
    }
    return next;
  });
}

function finishAssistant(messages: PiChatMessage[]): PiChatMessage[] {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "assistant") return messages;
  return [...messages.slice(0, -1), { ...last, streaming: false }];
}

function reducePiEvent(messages: PiChatMessage[], event: PiRpcEvent): PiChatMessage[] {
  switch (event.type) {
    case "agent_start":
    case "message_start":
      return ensureAssistantMessage(messages);

    case "agent_end":
    case "message_end":
    case "process_exit":
      return finishAssistant(messages);

    case "message_update":
      return reduceAssistantEvent(messages, event);

    case "tool_execution_start":
      return upsertTool(messages, toolSnapshotFromExecutionEvent(event, "running"));

    case "tool_execution_update":
      return upsertTool(messages, toolSnapshotFromExecutionEvent(event, "running", "partialResult"));

    case "tool_execution_end":
      return upsertTool(messages, toolSnapshotFromExecutionEvent(event, event.isError === true ? "error" : "done", "result"));

    case "response":
      return event.success === false ? appendErrorBlock(messages, normalizePiError(event)) : messages;

    case "stderr":
    case "process_error":
    case "extension_error":
      return appendErrorBlock(messages, normalizePiError(event));

    default:
      return messages;
  }
}

function reduceAssistantEvent(messages: PiChatMessage[], event: PiRpcEvent): PiChatMessage[] {
  const assistantEvent = getAssistantEvent(event);
  if (!assistantEvent) return messages;

  const contentIndex = getContentIndex(assistantEvent);
  switch (assistantEvent.type) {
    case "start":
    case "text_start":
    case "thinking_start":
      return ensureAssistantMessage(messages);

    case "text_delta":
      return appendContent(messages, "text", readString(assistantEvent.delta), contentIndex);

    case "thinking_delta":
      return appendContent(messages, "thinking", readString(assistantEvent.delta), contentIndex);

    case "text_end":
      return appendContent(messages, "text", readString(assistantEvent.content), contentIndex, "replace");

    case "thinking_end":
      return appendContent(messages, "thinking", readString(assistantEvent.content), contentIndex, "replace");

    case "toolcall_start":
    case "toolcall_delta":
    case "toolcall_end": {
      const toolCall = extractToolCall(assistantEvent.toolCall ?? assistantEvent.partial);
      return upsertTool(messages, {
        id: toolCall.id ?? readString(assistantEvent.toolCallId),
        name: toolCall.name || "tool",
        args: toolCall.args ?? null,
        output: "",
        status: "pending",
      });
    }

    case "error":
      return appendErrorBlock(messages, normalizePiError(assistantEvent));

    case "done":
      return finishAssistant(messages);

    default:
      return messages;
  }
}

function updateStreamingTabs(streamingTabs: Set<string>, tabId: string, event: PiRpcEvent): Set<string> {
  const next = new Set(streamingTabs);
  switch (event.type) {
    case "agent_start":
    case "message_start":
    case "message_update":
    case "tool_execution_start":
    case "tool_execution_update":
      next.add(tabId);
      break;

    case "agent_end":
    case "turn_end":
    case "message_end":
    case "tool_execution_end":
    case "process_exit":
      next.delete(tabId);
      break;

    case "response":
      if (event.success === false) next.delete(tabId);
      break;
  }

  const assistantEvent = event.type === "message_update" ? getAssistantEvent(event) : null;
  if (assistantEvent?.type === "error" || assistantEvent?.type === "done") {
    next.delete(tabId);
  }

  return next;
}

export const usePiChatStore = create<PiChatState>((set) => ({
  chats: new Map(),
  streamingTabs: new Set(),
  permissionModes: new Map(),

  addUserMessage: (tabId, text) =>
    set((state) => {
      const chats = new Map(state.chats);
      const messages = [...getMessages(chats, tabId)];
      messages.push({
        id: crypto.randomUUID(),
        role: "user",
        blocks: [{ type: "text", content: text }],
        timestamp: Date.now(),
      });
      chats.set(tabId, messages);
      return { chats };
    }),

  appendEvent: (tabId, event) =>
    set((state) => {
      const chats = new Map(state.chats);
      const messages = reducePiEvent([...getMessages(chats, tabId)], event);
      chats.set(tabId, messages);

      const nextState: Partial<PiChatState> = {
        chats,
        streamingTabs: updateStreamingTabs(state.streamingTabs, tabId, event),
      };

      if (event.type === "extension_ui_request" && event.method === "setStatus" && event.statusKey === "permissions") {
        const mode = getPermissionModeFromStatus(event.statusText);
        if (mode) {
          const permissionModes = new Map(state.permissionModes);
          permissionModes.set(tabId, mode);
          nextState.permissionModes = permissionModes;
        }
      }

      return nextState;
    }),

  appendError: (tabId, message) =>
    set((state) => {
      const chats = new Map(state.chats);
      const messages = appendErrorBlock([...getMessages(chats, tabId)], message);
      chats.set(tabId, messages);
      const streamingTabs = new Set(state.streamingTabs);
      streamingTabs.delete(tabId);
      return { chats, streamingTabs };
    }),

  removeChat: (tabId) =>
    set((state) => {
      const chats = new Map(state.chats);
      chats.delete(tabId);
      const streamingTabs = new Set(state.streamingTabs);
      streamingTabs.delete(tabId);
      const permissionModes = new Map(state.permissionModes);
      permissionModes.delete(tabId);
      return { chats, streamingTabs, permissionModes };
    }),
}));
