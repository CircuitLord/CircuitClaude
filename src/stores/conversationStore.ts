import { create } from "zustand";
import type { ClaudeEvent, ConversationMessage, SessionStats, PermissionStatus, QuestionStatus, UserQuestionItem } from "../types";

export type ActivePrompt =
  | { kind: "permission"; permissionId: string; tool: string; input: unknown; description: string }
  | { kind: "question"; questionId: string; questions: UserQuestionItem[] };

export interface ConversationState {
  conversations: Map<string, ConversationMessage[]>; // tabId → messages
  streamingTabs: Set<string>; // tabs where Claude is currently responding
  sessionStats: Map<string, SessionStats>; // tabId → cumulative session stats
  pendingPermissions: Map<string, string>; // permissionId → tabId
  pendingQuestions: Map<string, string>; // questionId → tabId

  addUserMessage: (tabId: string, text: string) => void;
  appendToAssistant: (tabId: string, event: ClaudeEvent) => void;
  markStreamingDone: (tabId: string) => void;
  loadHistory: (tabId: string, messages: ConversationMessage[]) => void;
  clearConversation: (tabId: string) => void;
  removeConversation: (tabId: string) => void;
  resolvePermission: (tabId: string, permissionId: string, status: PermissionStatus) => void;
  resolveQuestion: (tabId: string, questionId: string, answers: Record<string, string>) => void;
}

function getOrCreateMessages(map: Map<string, ConversationMessage[]>, tabId: string): ConversationMessage[] {
  let msgs = map.get(tabId);
  if (!msgs) {
    msgs = [];
    map.set(tabId, msgs);
  }
  return msgs;
}

export const useConversationStore = create<ConversationState>((set) => ({
  conversations: new Map(),
  streamingTabs: new Set(),
  sessionStats: new Map(),
  pendingPermissions: new Map(),
  pendingQuestions: new Map(),

  addUserMessage: (tabId, text) =>
    set((state) => {
      const next = new Map(state.conversations);
      const msgs = [...getOrCreateMessages(next, tabId)];
      msgs.push({
        id: crypto.randomUUID(),
        role: "user",
        blocks: [{ type: "text", content: text }],
        timestamp: Date.now(),
      });
      next.set(tabId, msgs);
      return { conversations: next };
    }),

  appendToAssistant: (tabId, event) =>
    set((state) => {
      const next = new Map(state.conversations);
      const msgs = [...getOrCreateMessages(next, tabId)];

      switch (event.type) {
        case "MessageStart": {
          // Create a new assistant message
          msgs.push({
            id: crypto.randomUUID(),
            role: "assistant",
            blocks: [],
            timestamp: Date.now(),
            streaming: true,
          });
          const nextStreaming = new Set(state.streamingTabs);
          nextStreaming.add(tabId);
          next.set(tabId, msgs);
          return { conversations: next, streamingTabs: nextStreaming };
        }

        case "Text": {
          const last = msgs[msgs.length - 1];
          if (!last || last.role !== "assistant") break;
          const updated = { ...last, blocks: [...last.blocks] };
          const lastBlock = updated.blocks[updated.blocks.length - 1];
          if (lastBlock && lastBlock.type === "text") {
            // Append to existing text block
            updated.blocks[updated.blocks.length - 1] = {
              ...lastBlock,
              content: lastBlock.content + event.data.text,
            };
          } else {
            // Create new text block
            updated.blocks.push({ type: "text", content: event.data.text });
          }
          msgs[msgs.length - 1] = updated;
          break;
        }

        case "Thinking": {
          const last = msgs[msgs.length - 1];
          if (!last || last.role !== "assistant") break;
          const updated = { ...last, blocks: [...last.blocks] };
          const lastBlock = updated.blocks[updated.blocks.length - 1];
          if (lastBlock && lastBlock.type === "thinking") {
            updated.blocks[updated.blocks.length - 1] = {
              ...lastBlock,
              content: lastBlock.content + event.data.text,
            };
          } else {
            updated.blocks.push({ type: "thinking", content: event.data.text });
          }
          msgs[msgs.length - 1] = updated;
          break;
        }

        case "ToolUse": {
          const last = msgs[msgs.length - 1];
          if (!last || last.role !== "assistant") break;
          const updated = { ...last, blocks: [...last.blocks] };
          updated.blocks.push({
            type: "tool_use",
            content: "",
            toolName: event.data.name,
            toolUseId: event.data.id,
            toolInput: event.data.input,
          });
          msgs[msgs.length - 1] = updated;
          break;
        }

        case "ToolResult": {
          const last = msgs[msgs.length - 1];
          if (!last || last.role !== "assistant") break;
          const updated = { ...last, blocks: [...last.blocks] };
          updated.blocks.push({
            type: "tool_result",
            content: event.data.content,
            toolUseId: event.data.tool_use_id,
            isError: event.data.is_error,
          });
          msgs[msgs.length - 1] = updated;
          break;
        }

        case "PermissionRequest": {
          const last = msgs[msgs.length - 1];
          if (!last || last.role !== "assistant") break;
          const updated = { ...last, blocks: [...last.blocks] };
          updated.blocks.push({
            type: "permission_request",
            content: "",
            permissionId: event.data.id,
            permissionTool: event.data.tool,
            toolInput: event.data.input,
            permissionDescription: event.data.description,
            permissionStatus: "pending",
          });
          msgs[msgs.length - 1] = updated;
          const nextPending = new Map(state.pendingPermissions);
          nextPending.set(event.data.id, tabId);
          next.set(tabId, msgs);
          return { conversations: next, pendingPermissions: nextPending };
        }

        case "UserQuestion": {
          const last = msgs[msgs.length - 1];
          if (!last || last.role !== "assistant") break;
          const updated = { ...last, blocks: [...last.blocks] };
          updated.blocks.push({
            type: "user_question",
            content: "",
            questionId: event.data.id,
            questions: event.data.questions,
            questionStatus: "pending",
          });
          msgs[msgs.length - 1] = updated;
          const nextPendingQ = new Map(state.pendingQuestions);
          nextPendingQ.set(event.data.id, tabId);
          next.set(tabId, msgs);
          return { conversations: next, pendingQuestions: nextPendingQ };
        }

        case "Error": {
          const last = msgs[msgs.length - 1];
          if (!last || last.role !== "assistant") break;
          const updated = { ...last, blocks: [...last.blocks] };
          updated.blocks.push({
            type: "error",
            content: event.data.message,
            isError: true,
          });
          msgs[msgs.length - 1] = updated;
          break;
        }

        case "System": {
          const nextStats = new Map(state.sessionStats);
          const prev = nextStats.get(tabId);
          nextStats.set(tabId, {
            ...prev ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, contextWindow: 0, turns: 0, durationMs: 0 },
            model: event.data.model || prev?.model || "",
          });
          next.set(tabId, msgs);
          return { conversations: next, sessionStats: nextStats };
        }

        case "Ready": {
          // No-op — bridge is ready for next message
          break;
        }

        case "Result": {
          const usage = event.data.model_usage;
          if (usage) {
            const nextStats = new Map(state.sessionStats);
            const prev = nextStats.get(tabId) ?? { model: "", inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, contextWindow: 0, turns: 0, durationMs: 0 };
            nextStats.set(tabId, {
              model: usage.model || prev.model,
              inputTokens: prev.inputTokens + usage.input_tokens,
              outputTokens: prev.outputTokens + usage.output_tokens,
              cacheReadTokens: prev.cacheReadTokens + usage.cache_read_input_tokens,
              cacheCreationTokens: prev.cacheCreationTokens + usage.cache_creation_input_tokens,
              contextWindow: usage.context_window,
              turns: event.data.num_turns,
              durationMs: prev.durationMs + event.data.duration_ms,
            });
            next.set(tabId, msgs);
            return { conversations: next, sessionStats: nextStats };
          }
          break;
        }

        case "MessageStop": {
          const last = msgs[msgs.length - 1];
          if (last && last.role === "assistant") {
            msgs[msgs.length - 1] = { ...last, streaming: false };
          }
          const nextStreaming = new Set(state.streamingTabs);
          nextStreaming.delete(tabId);
          next.set(tabId, msgs);
          return { conversations: next, streamingTabs: nextStreaming };
        }
      }

      next.set(tabId, msgs);
      return { conversations: next };
    }),

  resolvePermission: (tabId, permissionId, status) =>
    set((state) => {
      const next = new Map(state.conversations);
      const msgs = [...getOrCreateMessages(next, tabId)];

      // Find and update the permission block
      for (let i = msgs.length - 1; i >= 0; i--) {
        const msg = msgs[i];
        const blockIdx = msg.blocks.findIndex(
          (b) => b.type === "permission_request" && b.permissionId === permissionId
        );
        if (blockIdx !== -1) {
          const updated = { ...msg, blocks: [...msg.blocks] };
          updated.blocks[blockIdx] = { ...updated.blocks[blockIdx], permissionStatus: status };
          msgs[i] = updated;
          break;
        }
      }

      const nextPending = new Map(state.pendingPermissions);
      nextPending.delete(permissionId);
      next.set(tabId, msgs);
      return { conversations: next, pendingPermissions: nextPending };
    }),

  resolveQuestion: (tabId, questionId, answers) =>
    set((state) => {
      const next = new Map(state.conversations);
      const msgs = [...getOrCreateMessages(next, tabId)];

      // Find and update the question block
      for (let i = msgs.length - 1; i >= 0; i--) {
        const msg = msgs[i];
        const blockIdx = msg.blocks.findIndex(
          (b) => b.type === "user_question" && b.questionId === questionId
        );
        if (blockIdx !== -1) {
          const updated = { ...msg, blocks: [...msg.blocks] };
          updated.blocks[blockIdx] = {
            ...updated.blocks[blockIdx],
            questionStatus: "answered" as QuestionStatus,
            answers,
          };
          msgs[i] = updated;
          break;
        }
      }

      const nextPendingQ = new Map(state.pendingQuestions);
      nextPendingQ.delete(questionId);
      next.set(tabId, msgs);
      return { conversations: next, pendingQuestions: nextPendingQ };
    }),

  markStreamingDone: (tabId) =>
    set((state) => {
      const nextStreaming = new Set(state.streamingTabs);
      nextStreaming.delete(tabId);
      const next = new Map(state.conversations);
      const msgs = [...getOrCreateMessages(next, tabId)];
      const last = msgs[msgs.length - 1];
      if (last && last.role === "assistant" && last.streaming) {
        msgs[msgs.length - 1] = { ...last, streaming: false };
        next.set(tabId, msgs);
      }
      return { conversations: next, streamingTabs: nextStreaming };
    }),

  loadHistory: (tabId, messages) =>
    set((state) => {
      const next = new Map(state.conversations);
      next.set(tabId, messages);
      return { conversations: next };
    }),

  clearConversation: (tabId) =>
    set((state) => {
      const next = new Map(state.conversations);
      next.set(tabId, []);
      return { conversations: next };
    }),

  removeConversation: (tabId) =>
    set((state) => {
      const next = new Map(state.conversations);
      next.delete(tabId);
      const nextStreaming = new Set(state.streamingTabs);
      nextStreaming.delete(tabId);
      const nextStats = new Map(state.sessionStats);
      nextStats.delete(tabId);
      // Clean up any pending permissions/questions for this tab
      const nextPending = new Map(state.pendingPermissions);
      for (const [id, tid] of nextPending) {
        if (tid === tabId) nextPending.delete(id);
      }
      const nextPendingQ = new Map(state.pendingQuestions);
      for (const [id, tid] of nextPendingQ) {
        if (tid === tabId) nextPendingQ.delete(id);
      }
      return { conversations: next, streamingTabs: nextStreaming, sessionStats: nextStats, pendingPermissions: nextPending, pendingQuestions: nextPendingQ };
    }),
}));

export function selectActivePrompt(state: ConversationState, tabId: string): ActivePrompt | null {
  // Check pending permissions for this tab
  for (const [permissionId, tid] of state.pendingPermissions) {
    if (tid !== tabId) continue;
    // Find the permission block in messages to extract tool/description
    const msgs = state.conversations.get(tabId);
    if (!msgs) continue;
    for (let i = msgs.length - 1; i >= 0; i--) {
      for (const block of msgs[i].blocks) {
        if (block.type === "permission_request" && block.permissionId === permissionId && block.permissionStatus === "pending") {
          return {
            kind: "permission",
            permissionId,
            tool: block.permissionTool ?? "",
            input: block.toolInput,
            description: block.permissionDescription ?? "",
          };
        }
      }
    }
  }

  // Check pending questions for this tab
  for (const [questionId, tid] of state.pendingQuestions) {
    if (tid !== tabId) continue;
    const msgs = state.conversations.get(tabId);
    if (!msgs) continue;
    for (let i = msgs.length - 1; i >= 0; i--) {
      for (const block of msgs[i].blocks) {
        if (block.type === "user_question" && block.questionId === questionId && block.questionStatus === "pending") {
          return {
            kind: "question",
            questionId,
            questions: block.questions ?? [],
          };
        }
      }
    }
  }

  return null;
}
