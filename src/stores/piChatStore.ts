import { create } from "zustand";
import {
  aggregateToolMeta,
  aggregateToolStatus,
  type PiToolAggregate,
} from "../lib/piToolDisplay";
import {
  extractTextContent,
  extractToolCall,
  getAssistantEvent,
  getContentIndex,
  getPermissionModeFromStatus,
  isFinalPiCompletionEvent,
  normalizePiError,
  readNumber,
  readRecord,
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
  | { type: "tool"; id: string; name: string; args: unknown; output: string; status: PiToolStatus; aggregate?: PiToolAggregate; contentIndex?: number; hidden?: boolean; startedAt?: number; durationMs?: number }
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
  queuedSteering: Map<string, string[]>;
  queuedFollowUp: Map<string, string[]>;
  toolCallArgs: Map<string, Map<string, PiToolSnapshot>>;
  setMessagesFromPi: (tabId: string, rawMessages: unknown[]) => void;
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

function createAssistantMessage(messages: PiChatMessage[]): PiChatMessage[] {
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

function findLastStreamingAssistantIndex(messages: PiChatMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "assistant" && message.streaming) return index;
  }
  return -1;
}

function ensureAssistantMessage(messages: PiChatMessage[]): PiChatMessage[] {
  return findLastStreamingAssistantIndex(messages) !== -1 ? messages : createAssistantMessage(messages);
}

function startAssistantMessage(messages: PiChatMessage[]): PiChatMessage[] {
  return findLastStreamingAssistantIndex(messages) !== -1 ? messages : createAssistantMessage(messages);
}

function updateAssistantBlocks(
  messages: PiChatMessage[],
  updater: (blocks: PiChatBlock[]) => PiChatBlock[],
): PiChatMessage[] {
  const ensured = ensureAssistantMessage(messages);
  const index = findLastStreamingAssistantIndex(ensured);
  const message = ensured[index];
  if (!message || message.role !== "assistant") return ensured;
  return [
    ...ensured.slice(0, index),
    { ...message, blocks: updater(message.blocks) },
    ...ensured.slice(index + 1),
  ];
}

function blockHasToolId(block: PiChatBlock, id: string): boolean {
  return block.type === "tool" && (block.id === id || block.aggregate?.items.some((item) => item.id === id) === true);
}

function blockHasAggregateToolId(block: PiChatBlock, id: string): boolean {
  return block.type === "tool" && block.aggregate?.items.some((item) => item.id === id) === true;
}

function blockIsOpenAggregate(block: PiChatBlock): boolean {
  return block.type === "tool" && block.aggregate !== undefined && !block.aggregate.finalized;
}

function blockIsHiddenToolSlot(block: PiChatBlock, id: string): boolean {
  return block.type === "tool" && !block.aggregate && block.id === id && block.hidden === true;
}

function blockIsVisible(block: PiChatBlock): boolean {
  if (block.type === "thinking") return false;
  return block.type !== "tool" || block.hidden !== true;
}

function blockIsAggregateBoundary(block: PiChatBlock): boolean {
  return blockIsVisible(block) && (block.type !== "tool" || block.aggregate === undefined);
}

function updateMessageBlocksAt(
  messages: PiChatMessage[],
  index: number,
  updater: (blocks: PiChatBlock[]) => PiChatBlock[],
): PiChatMessage[] {
  const message = messages[index];
  if (!message || message.role !== "assistant") return messages;
  return [
    ...messages.slice(0, index),
    { ...message, blocks: updater(message.blocks) },
    ...messages.slice(index + 1),
  ];
}

function removeHiddenToolSlots(messages: PiChatMessage[], id: string): PiChatMessage[] {
  let changed = false;
  const next = messages.map((message) => {
    if (message.role !== "assistant") return message;
    const blocks = message.blocks.filter((block) => !blockIsHiddenToolSlot(block, id));
    if (blocks.length === message.blocks.length) return message;
    changed = true;
    return { ...message, blocks };
  });
  return changed ? next : messages;
}

function updateToolBlocks(
  messages: PiChatMessage[],
  id: string,
  updater: (blocks: PiChatBlock[]) => PiChatBlock[],
): PiChatMessage[] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "assistant" || !message.blocks.some((block) => blockHasToolId(block, id))) continue;
    return updateMessageBlocksAt(messages, index, updater);
  }
  return updateAssistantBlocks(messages, updater);
}

function findMessageIndexFromEnd(messages: PiChatMessage[], predicate: (block: PiChatBlock) => boolean): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "assistant" && message.blocks.some(predicate)) return index;
  }
  return -1;
}

function findHiddenToolSlotPosition(messages: PiChatMessage[], id: string): { messageIndex: number; blockIndex: number } | undefined {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex];
    if (message?.role !== "assistant") continue;
    const blockIndex = message.blocks.findIndex((block) => blockIsHiddenToolSlot(block, id));
    if (blockIndex !== -1) return { messageIndex, blockIndex };
  }
  return undefined;
}

function findAggregateToolTargetMessageIndex(messages: PiChatMessage[], id: string): number {
  const existingAggregateIndex = findMessageIndexFromEnd(messages, (block) => blockHasAggregateToolId(block, id));
  if (existingAggregateIndex !== -1) return existingAggregateIndex;

  const slot = findHiddenToolSlotPosition(messages, id);
  let boundarySeen = false;
  const startMessageIndex = slot?.messageIndex ?? messages.length - 1;

  for (let messageIndex = startMessageIndex; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex];
    if (message?.role !== "assistant") continue;
    const startBlockIndex = slot && messageIndex === slot.messageIndex ? slot.blockIndex - 1 : message.blocks.length - 1;

    for (let blockIndex = startBlockIndex; blockIndex >= 0; blockIndex -= 1) {
      const block = message.blocks[blockIndex];
      if (blockIsOpenAggregate(block) && !boundarySeen) return messageIndex;
      if (blockIsAggregateBoundary(block)) boundarySeen = true;
    }
  }

  return slot?.messageIndex ?? -1;
}

function updateAggregateToolBlocks(
  messages: PiChatMessage[],
  id: string,
  updater: (blocks: PiChatBlock[]) => PiChatBlock[],
): PiChatMessage[] {
  const targetIndex = findAggregateToolTargetMessageIndex(messages, id);
  const updated = targetIndex === -1
    ? updateAssistantBlocks(messages, updater)
    : updateMessageBlocksAt(messages, targetIndex, updater);
  return removeHiddenToolSlots(updated, id);
}

function insertBlockInStreamOrder(blocks: PiChatBlock[], block: PiChatBlock): PiChatBlock[] {
  if (block.type === "error" || block.contentIndex === undefined) return [...blocks, block];
  const insertAt = blocks.findIndex((existing) => {
    if (existing.type === "error" || existing.contentIndex === undefined) return false;
    return existing.contentIndex > block.contentIndex!;
  });
  if (insertAt === -1) return [...blocks, block];
  return [...blocks.slice(0, insertAt), block, ...blocks.slice(insertAt)];
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
      return insertBlockInStreamOrder(next, { type, content, contentIndex });
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

function reserveToolSlot(messages: PiChatMessage[], id: string, contentIndex?: number): PiChatMessage[] {
  return updateAssistantBlocks(messages, (blocks) => {
    if (blocks.some((block) => block.type === "tool" && (block.id === id || block.aggregate?.items.some((item) => item.id === id)))) {
      return blocks;
    }
    return insertBlockInStreamOrder(blocks, {
      type: "tool",
      id,
      name: "tool",
      args: null,
      output: "",
      status: "pending",
      contentIndex,
      hidden: true,
    });
  });
}

function finalizeOpenAggregates(blocks: PiChatBlock[]): PiChatBlock[] {
  let changed = false;
  const next = blocks.map((block) => {
    if (block.type !== "tool" || !block.aggregate || block.aggregate.finalized) return block;
    changed = true;
    return { ...block, aggregate: { ...block.aggregate, finalized: true } };
  });
  return changed ? next : blocks;
}

function findAggregateBlockIndex(blocks: PiChatBlock[], toolId: string): number {
  const existingIndex = blocks.findIndex(
    (block) => block.type === "tool" && block.aggregate?.items.some((item) => item.id === toolId),
  );
  if (existingIndex !== -1) return existingIndex;

  const hiddenSlotIndex = blocks.findIndex((block) => blockIsHiddenToolSlot(block, toolId));
  const startIndex = hiddenSlotIndex === -1 ? blocks.length - 1 : hiddenSlotIndex - 1;
  let boundarySeen = false;

  for (let index = startIndex; index >= 0; index -= 1) {
    const block = blocks[index];
    if (blockIsOpenAggregate(block) && !boundarySeen) return index;
    if (blockIsAggregateBoundary(block)) boundarySeen = true;
  }

  return hiddenSlotIndex;
}

function upsertAggregateTool(messages: PiChatMessage[], tool: PiToolSnapshot, id: string): PiChatMessage[] {
  const meta = aggregateToolMeta(tool.name, tool.args, id);
  if (!meta) return upsertNormalTool(messages, tool, id);

  return updateAggregateToolBlocks(messages, id, (blocks) => {
    const next = [...blocks];
    const index = findAggregateBlockIndex(next, id);

    if (index === -1) {
      const item = { id, status: tool.status, ...meta };
      return insertBlockInStreamOrder(next, {
        type: "tool",
        id: `aggregate-${id}`,
        name: "aggregate",
        args: null,
        output: "",
        status: aggregateToolStatus([item]),
        aggregate: { items: [item], activeId: id },
      });
    }

    const existing = next[index];
    if (existing.type !== "tool") return next;
    const aggregate = existing.aggregate ?? { items: [], activeId: id };

    const itemIndex = aggregate.items.findIndex((item) => item.id === id);
    const items = [...aggregate.items];
    const previous = itemIndex === -1 ? undefined : items[itemIndex];
    const item = { ...(previous ?? {}), id, status: tool.status, ...meta };
    if (itemIndex === -1) items.push(item);
    else items[itemIndex] = item;

    const shouldActivate = itemIndex === -1 || tool.status === "pending" || tool.status === "running";
    next[index] = {
      ...existing,
      id: existing.aggregate ? existing.id : `aggregate-${id}`,
      name: "aggregate",
      args: null,
      output: "",
      status: aggregateToolStatus(items),
      hidden: false,
      aggregate: {
        items,
        activeId: shouldActivate ? id : aggregate.activeId,
        finalized: aggregate.finalized,
      },
    };
    return next.filter((block, blockIndex) => blockIndex === index || !(block.type === "tool" && !block.aggregate && block.id === id && block.hidden));
  });
}

function upsertNormalTool(messages: PiChatMessage[], tool: PiToolSnapshot, id: string): PiChatMessage[] {
  return updateToolBlocks(messages, id, (blocks) => {
    const next = [...blocks];
    const index = next.findIndex((block) => block.type === "tool" && !block.aggregate && block.id === id);

    if (index === -1) {
      return insertBlockInStreamOrder(next, { type: "tool", ...tool, id, startedAt: Date.now() });
    }

    const existing = next[index];
    if (existing.type === "tool") {
      const isTerminal = tool.status === "done" || tool.status === "error";
      const durationMs = isTerminal && existing.durationMs === undefined && existing.startedAt !== undefined
        ? Date.now() - existing.startedAt
        : existing.durationMs;
      next[index] = {
        ...existing,
        name: tool.name || existing.name,
        args: tool.args ?? existing.args,
        output: tool.output || existing.output,
        status: tool.status,
        hidden: false,
        durationMs,
      };
    }
    return next;
  });
}

function upsertTool(messages: PiChatMessage[], tool: PiToolSnapshot): PiChatMessage[] {
  const id = tool.id || "tool";
  return aggregateToolMeta(tool.name, tool.args, id)
    ? upsertAggregateTool(messages, tool, id)
    : upsertNormalTool(messages, tool, id);
}

function finalizeToolGroups(messages: PiChatMessage[]): PiChatMessage[] {
  let changed = false;
  const next = messages.map((message) => {
    if (message.role !== "assistant") return message;
    const blocks = finalizeOpenAggregates(message.blocks);
    if (blocks === message.blocks) return message;
    changed = true;
    return { ...message, blocks };
  });
  return changed ? next : messages;
}

function finalizeAggregateBoundaries(messages: PiChatMessage[]): PiChatMessage[] {
  let changed = false;
  let boundarySeen = false;
  const next = [...messages];

  for (let messageIndex = next.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = next[messageIndex];
    if (message.role !== "assistant") continue;

    let blocksChanged = false;
    const blocks = [...message.blocks];
    for (let blockIndex = blocks.length - 1; blockIndex >= 0; blockIndex -= 1) {
      const block = blocks[blockIndex];
      if (block.type === "tool" && block.aggregate && !block.aggregate.finalized && boundarySeen) {
        blocks[blockIndex] = { ...block, aggregate: { ...block.aggregate, finalized: true } };
        blocksChanged = true;
        changed = true;
        continue;
      }
      if (blockIsAggregateBoundary(block)) boundarySeen = true;
    }

    if (blocksChanged) next[messageIndex] = { ...message, blocks };
  }

  return changed ? next : messages;
}

function closeAssistantMessage(messages: PiChatMessage[]): PiChatMessage[] {
  const index = findLastStreamingAssistantIndex(messages);
  const message = messages[index];
  if (!message || message.role !== "assistant") return messages;
  if (!message.blocks.some(blockIsVisible)) return [...messages.slice(0, index), ...messages.slice(index + 1)];
  return [
    ...messages.slice(0, index),
    { ...message, streaming: false },
    ...messages.slice(index + 1),
  ];
}

function finishAssistant(messages: PiChatMessage[]): PiChatMessage[] {
  return closeAssistantMessage(finalizeToolGroups(messages));
}

function getCachedToolSnapshot(toolCache: Map<string, PiToolSnapshot> | undefined, id: string): PiToolSnapshot | undefined {
  return id ? toolCache?.get(id) : undefined;
}

function withCachedToolArgs(tool: PiToolSnapshot, toolCache: Map<string, PiToolSnapshot> | undefined): PiToolSnapshot {
  const cached = getCachedToolSnapshot(toolCache, tool.id);
  if (!cached) return tool;
  return {
    ...tool,
    name: tool.name === "tool" ? cached.name : tool.name,
    args: tool.args ?? cached.args,
  };
}

function executionToolSnapshot(
  event: PiRpcEvent,
  status: PiToolStatus,
  toolCache: Map<string, PiToolSnapshot> | undefined,
  resultField?: "partialResult" | "result",
): PiToolSnapshot {
  return withCachedToolArgs(toolSnapshotFromExecutionEvent(event, status, resultField), toolCache);
}

function isRenderableTool(tool: PiToolSnapshot): boolean {
  return tool.name !== "tool" || aggregateToolMeta(tool.name, tool.args, tool.id) !== undefined;
}

function upsertRenderableTool(messages: PiChatMessage[], tool: PiToolSnapshot): PiChatMessage[] {
  return isRenderableTool(tool) ? upsertTool(messages, tool) : ensureAssistantMessage(messages);
}

function readQueueTexts(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (typeof item === "string") return item;
      return extractTextContent(item);
    })
    .filter(Boolean);
}

function reducePiEvent(
  messages: PiChatMessage[],
  event: PiRpcEvent,
  toolCache?: Map<string, PiToolSnapshot>,
): PiChatMessage[] {
  switch (event.type) {
    case "agent_start":
      return ensureAssistantMessage(messages);

    case "message_start":
      return startAssistantMessage(messages);

    case "agent_end":
    case "process_exit":
      return finishAssistant(messages);

    case "message_end":
      return closeAssistantMessage(finalizeAggregateBoundaries(messages));

    case "message_update":
      return reduceAssistantEvent(messages, event, toolCache);

    case "tool_execution_start":
      return upsertRenderableTool(messages, executionToolSnapshot(event, "running", toolCache));

    case "tool_execution_update":
      return upsertRenderableTool(messages, executionToolSnapshot(event, "running", toolCache, "partialResult"));

    case "tool_execution_end":
      return upsertRenderableTool(messages, executionToolSnapshot(event, event.isError === true ? "error" : "done", toolCache, "result"));

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

function reduceAssistantEvent(
  messages: PiChatMessage[],
  event: PiRpcEvent,
  toolCache?: Map<string, PiToolSnapshot>,
): PiChatMessage[] {
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
      return ensureAssistantMessage(messages);

    case "text_end":
      return appendContent(messages, "text", readString(assistantEvent.content), contentIndex, "replace");

    case "thinking_end":
      return ensureAssistantMessage(messages);

    case "toolcall_start":
    case "toolcall_delta":
    case "toolcall_end": {
      const rawToolCall = extractToolCall(assistantEvent.toolCall ?? assistantEvent.partial);
      const id = rawToolCall.id || readString(assistantEvent.toolCallId);
      if (!id) return ensureAssistantMessage(messages);

      const withSlot = reserveToolSlot(messages, id, contentIndex);
      const cached = getCachedToolSnapshot(toolCache, id);
      const tool: PiToolSnapshot = {
        id,
        name: rawToolCall.name || cached?.name || "tool",
        args: rawToolCall.args ?? cached?.args ?? null,
        output: "",
        status: "running",
      };
      return upsertRenderableTool(withSlot, tool);
    }

    case "error":
      return appendErrorBlock(messages, normalizePiError(assistantEvent));

    case "done":
      return closeAssistantMessage(finalizeAggregateBoundaries(messages));

    default:
      return messages;
  }
}

function updateToolCallArgs(
  toolCallArgs: Map<string, Map<string, PiToolSnapshot>>,
  tabId: string,
  event: PiRpcEvent,
): Map<string, Map<string, PiToolSnapshot>> {
  if (event.type !== "message_update") return toolCallArgs;
  const assistantEvent = getAssistantEvent(event);
  if (!assistantEvent?.type?.startsWith("toolcall_")) return toolCallArgs;

  const toolCall = extractToolCall(assistantEvent.toolCall ?? assistantEvent.partial);
  const id = toolCall.id || readString(assistantEvent.toolCallId);
  if (!id) return toolCallArgs;

  const currentTabCache = toolCallArgs.get(tabId);
  const previous = currentTabCache?.get(id);
  const nextTool: PiToolSnapshot = {
    id,
    name: toolCall.name || previous?.name || "tool",
    args: toolCall.args ?? previous?.args ?? null,
    output: "",
    status: "pending",
  };

  const nextTabCache = new Map(currentTabCache);
  nextTabCache.set(id, nextTool);
  const next = new Map(toolCallArgs);
  next.set(tabId, nextTabCache);
  return next;
}

function timestampFromMessage(message: Record<string, unknown>): number {
  return readNumber(message.timestamp) ?? Date.now();
}

function blocksFromPiContent(content: unknown, toolCache?: Map<string, PiToolSnapshot>): PiChatBlock[] {
  if (typeof content === "string") return content ? [{ type: "text", content }] : [];
  if (!Array.isArray(content)) return [];

  return content.flatMap((part): PiChatBlock[] => {
    const item = readRecord(part);
    if (!item) return [];

    switch (readString(item.type)) {
      case "text": {
        const text = readString(item.text) || readString(item.content);
        return text ? [{ type: "text", content: text }] : [];
      }
      case "thinking":
        return [];
      case "toolCall": {
        const id = readString(item.id) || crypto.randomUUID();
        const tool: PiToolSnapshot = {
          id,
          name: readString(item.name) || "tool",
          args: item.arguments ?? item.args ?? null,
          output: "",
          status: "pending",
        };
        toolCache?.set(id, tool);
        return [{ type: "tool", ...tool, hidden: true }];
      }
      default:
        return [];
    }
  });
}

function isTurnChangeSummaryMessage(message: Record<string, unknown>): boolean {
  return readString(message.customType) === "turn-change-summary"
    || readString(message.custom_type) === "turn-change-summary";
}

function piRawMessagesToChatMessages(rawMessages: unknown[]): PiChatMessage[] {
  let messages: PiChatMessage[] = [];
  const toolCache = new Map<string, PiToolSnapshot>();

  for (const rawMessage of rawMessages) {
    const message = readRecord(rawMessage);
    if (!message) continue;

    const timestamp = timestampFromMessage(message);
    switch (readString(message.role)) {
      case "user": {
        const content = extractTextContent(message);
        messages = [...messages, {
          id: crypto.randomUUID(),
          role: "user",
          blocks: content ? [{ type: "text", content }] : [],
          timestamp,
        }];
        break;
      }
      case "assistant": {
        const blocks = blocksFromPiContent(message.content, toolCache);
        const error = readString(message.errorMessage);
        messages = [...messages, {
          id: crypto.randomUUID(),
          role: "assistant",
          blocks: error ? [...blocks, { type: "error", content: error }] : blocks,
          timestamp,
        }];
        break;
      }
      case "toolResult": {
        const id = readString(message.toolCallId) || crypto.randomUUID();
        messages = upsertTool(messages, withCachedToolArgs({
          id,
          name: readString(message.toolName) || "tool",
          args: null,
          output: extractTextContent(message),
          status: message.isError === true ? "error" : "done",
        }, toolCache));
        break;
      }
      case "bashExecution": {
        messages = upsertTool(messages, {
          id: crypto.randomUUID(),
          name: "bash",
          args: { command: readString(message.command) },
          output: readString(message.output),
          status: message.cancelled === true || (readNumber(message.exitCode) !== undefined && readNumber(message.exitCode) !== 0) ? "error" : "done",
        });
        break;
      }
      case "custom": {
        if (isTurnChangeSummaryMessage(message)) break;
        if (message.display === false) break;
        const content = extractTextContent(message);
        if (!content) break;
        messages = [...messages, {
          id: crypto.randomUUID(),
          role: "assistant",
          blocks: [{ type: "text", content }],
          timestamp,
        }];
        break;
      }
      case "branchSummary":
      case "compactionSummary": {
        const summary = readString(message.summary);
        if (!summary) break;
        messages = [...messages, {
          id: crypto.randomUUID(),
          role: "assistant",
          blocks: [{ type: "text", content: summary }],
          timestamp,
        }];
        break;
      }
    }
  }

  return finalizeToolGroups(messages).map((message) => ({ ...message, streaming: false }));
}

function updateStreamingTabs(streamingTabs: Set<string>, tabId: string, event: PiRpcEvent): Set<string> {
  const next = new Set(streamingTabs);
  switch (event.type) {
    case "agent_start":
    case "message_start":
    case "tool_execution_start":
    case "tool_execution_update":
      next.add(tabId);
      break;

    case "message_update":
      if (getAssistantEvent(event)) next.add(tabId);
      break;

    case "agent_end":
    case "process_exit":
    case "process_error":
      next.delete(tabId);
      break;

    case "message_end":
    case "turn_end":
      if (isFinalPiCompletionEvent(event)) next.delete(tabId);
      break;

    case "response":
      if (event.success === false) next.delete(tabId);
      break;
  }

  const assistantEvent = event.type === "message_update" ? getAssistantEvent(event) : null;
  if (assistantEvent?.type === "error" || (assistantEvent?.type === "done" && isFinalPiCompletionEvent(event))) {
    next.delete(tabId);
  }

  return next;
}

export const usePiChatStore = create<PiChatState>((set) => ({
  chats: new Map(),
  streamingTabs: new Set(),
  permissionModes: new Map(),
  queuedSteering: new Map(),
  queuedFollowUp: new Map(),
  toolCallArgs: new Map(),

  setMessagesFromPi: (tabId, rawMessages) =>
    set((state) => {
      const chats = new Map(state.chats);
      chats.set(tabId, piRawMessagesToChatMessages(rawMessages));
      const streamingTabs = new Set(state.streamingTabs);
      streamingTabs.delete(tabId);
      const toolCallArgs = new Map(state.toolCallArgs);
      toolCallArgs.delete(tabId);
      return { chats, streamingTabs, toolCallArgs };
    }),

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
      const toolCallArgs = updateToolCallArgs(state.toolCallArgs, tabId, event);
      const chats = new Map(state.chats);
      const messages = reducePiEvent([...getMessages(chats, tabId)], event, toolCallArgs.get(tabId));
      chats.set(tabId, messages);

      const nextState: Partial<PiChatState> = {
        chats,
        streamingTabs: updateStreamingTabs(state.streamingTabs, tabId, event),
        toolCallArgs,
      };

      if (event.type === "queue_update") {
        const queuedSteering = new Map(state.queuedSteering);
        const queuedFollowUp = new Map(state.queuedFollowUp);
        queuedSteering.set(tabId, readQueueTexts(event.steering ?? event.steer));
        queuedFollowUp.set(tabId, readQueueTexts(event.followUp));
        nextState.queuedSteering = queuedSteering;
        nextState.queuedFollowUp = queuedFollowUp;
      }

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
      const queuedSteering = new Map(state.queuedSteering);
      queuedSteering.delete(tabId);
      const queuedFollowUp = new Map(state.queuedFollowUp);
      queuedFollowUp.delete(tabId);
      const toolCallArgs = new Map(state.toolCallArgs);
      toolCallArgs.delete(tabId);
      return { chats, streamingTabs, permissionModes, queuedSteering, queuedFollowUp, toolCallArgs };
    }),
}));
