import { create } from "zustand";

export type PiRpcEvent = Record<string, unknown> & { type?: string };

export type PiChatBlock =
  | { type: "text"; content: string }
  | { type: "thinking"; content: string }
  | { type: "tool"; id: string; name: string; args: unknown; output: string; status: "pending" | "running" | "done" | "error" }
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

function appendDelta(messages: PiChatMessage[], type: "text" | "thinking", delta: string): PiChatMessage[] {
  const ensured = ensureAssistantMessage(messages);
  const last = ensured[ensured.length - 1];
  if (!last || last.role !== "assistant") return ensured;

  const blocks = [...last.blocks];
  const lastBlock = blocks[blocks.length - 1];
  if (lastBlock?.type === type) {
    blocks[blocks.length - 1] = { ...lastBlock, content: lastBlock.content + delta };
  } else {
    blocks.push({ type, content: delta });
  }

  return [...ensured.slice(0, -1), { ...last, blocks }];
}

function appendErrorBlock(messages: PiChatMessage[], content: string): PiChatMessage[] {
  const ensured = ensureAssistantMessage(messages);
  const last = ensured[ensured.length - 1];
  if (!last || last.role !== "assistant") return ensured;
  return [
    ...ensured.slice(0, -1),
    { ...last, blocks: [...last.blocks, { type: "error", content }] },
  ];
}

function upsertTool(
  messages: PiChatMessage[],
  id: string,
  name: string,
  args: unknown,
  output: string,
  status: "pending" | "running" | "done" | "error",
): PiChatMessage[] {
  const ensured = ensureAssistantMessage(messages);
  const last = ensured[ensured.length - 1];
  if (!last || last.role !== "assistant") return ensured;

  const blocks = [...last.blocks];
  const index = blocks.findIndex((block) => block.type === "tool" && block.id === id);
  if (index === -1) {
    blocks.push({ type: "tool", id, name, args, output, status });
  } else {
    const existing = blocks[index];
    if (existing.type === "tool") {
      blocks[index] = {
        ...existing,
        name: name || existing.name,
        args: args ?? existing.args,
        output,
        status,
      };
    }
  }

  return [...ensured.slice(0, -1), { ...last, blocks }];
}

function finishAssistant(messages: PiChatMessage[]): PiChatMessage[] {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "assistant") return messages;
  return [...messages.slice(0, -1), { ...last, streaming: false }];
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function extractTextContent(value: unknown): string {
  const record = readRecord(value);
  const content = record?.content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        const item = readRecord(part);
        if (!item) return "";
        return readString(item.text) || readString(item.content);
      })
      .filter(Boolean)
      .join("\n");
  }
  return readString(content) || readString(record?.text);
}

function normalizeError(event: PiRpcEvent): string {
  const responseMessage = readString(readRecord(event.error)?.message) || readString(event.error);
  return readString(event.message) || responseMessage || `${event.type ?? "pi_error"}`;
}

export const usePiChatStore = create<PiChatState>((set) => ({
  chats: new Map(),
  streamingTabs: new Set(),

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
      const streamingTabs = new Set(state.streamingTabs);
      let messages = [...getMessages(chats, tabId)];

      switch (event.type) {
        case "agent_start":
        case "message_start":
          messages = ensureAssistantMessage(messages);
          streamingTabs.add(tabId);
          break;

        case "agent_end":
          messages = finishAssistant(messages);
          streamingTabs.delete(tabId);
          break;

        case "message_end":
          messages = finishAssistant(messages);
          break;

        case "message_update": {
          const assistantEvent = readRecord(event.assistantMessageEvent);
          if (!assistantEvent) break;
          const eventType = assistantEvent.type;
          if (eventType === "text_delta") {
            messages = appendDelta(messages, "text", readString(assistantEvent.delta));
            streamingTabs.add(tabId);
          } else if (eventType === "thinking_delta") {
            messages = appendDelta(messages, "thinking", readString(assistantEvent.delta));
            streamingTabs.add(tabId);
          } else if (eventType === "toolcall_end") {
            const toolCall = readRecord(assistantEvent.toolCall);
            const id = readString(toolCall?.id) || `tool-${Date.now()}`;
            const name = readString(toolCall?.name) || "tool";
            messages = upsertTool(messages, id, name, toolCall?.arguments ?? null, "", "pending");
          } else if (eventType === "error") {
            messages = appendErrorBlock(messages, normalizeError(assistantEvent as PiRpcEvent));
            streamingTabs.delete(tabId);
          }
          break;
        }

        case "tool_execution_start": {
          const id = readString(event.toolCallId) || `tool-${Date.now()}`;
          messages = upsertTool(messages, id, readString(event.toolName) || "tool", event.args ?? null, "", "running");
          streamingTabs.add(tabId);
          break;
        }

        case "tool_execution_update": {
          const id = readString(event.toolCallId) || `tool-${Date.now()}`;
          const output = extractTextContent(event.partialResult);
          messages = upsertTool(messages, id, readString(event.toolName) || "tool", event.args ?? null, output, "running");
          streamingTabs.add(tabId);
          break;
        }

        case "tool_execution_end": {
          const id = readString(event.toolCallId) || `tool-${Date.now()}`;
          const isError = event.isError === true;
          const output = extractTextContent(event.result);
          messages = upsertTool(messages, id, readString(event.toolName) || "tool", event.args ?? null, output, isError ? "error" : "done");
          break;
        }

        case "response":
          if (event.success === false) {
            messages = appendErrorBlock(messages, normalizeError(event));
            streamingTabs.delete(tabId);
          }
          break;

        case "stderr":
        case "process_error":
        case "extension_error":
          messages = appendErrorBlock(messages, normalizeError(event));
          break;

        case "process_exit":
          messages = finishAssistant(messages);
          streamingTabs.delete(tabId);
          break;
      }

      chats.set(tabId, messages);
      return { chats, streamingTabs };
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
      return { chats, streamingTabs };
    }),
}));
