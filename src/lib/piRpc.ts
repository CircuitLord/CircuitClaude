import type { TabStatus } from "../types";

export type PiToolStatus = "pending" | "running" | "done" | "error";

export type PiPermissionMode = "default" | "bypassPermissions";

export type PiThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export interface PiModel {
  id: string;
  provider: string;
  name?: string;
  reasoning?: boolean;
  thinkingLevelMap?: Record<string, string | null>;
}

const EXTENDED_THINKING_LEVELS: PiThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];

/**
 * Mirror of pi's own `getSupportedThinkingLevels` (pi-ai/models.js) so the
 * effort selector only ever offers levels the active model actually supports.
 */
export function getSupportedThinkingLevels(model: PiModel | null | undefined): PiThinkingLevel[] {
  if (!model?.reasoning) return ["off"];
  return EXTENDED_THINKING_LEVELS.filter((level) => {
    const mapped = model.thinkingLevelMap?.[level];
    if (mapped === null) return false;
    if (level === "xhigh") return mapped !== undefined;
    return true;
  });
}

export type PiRpcCommand = Record<string, unknown> & {
  id?: string;
  type: string;
};

export type PiAssistantEvent = Record<string, unknown> & {
  type?:
    | "start"
    | "text_start"
    | "text_delta"
    | "text_end"
    | "thinking_start"
    | "thinking_delta"
    | "thinking_end"
    | "toolcall_start"
    | "toolcall_delta"
    | "toolcall_end"
    | "done"
    | "error";
};

export type PiRpcEvent = Record<string, unknown> & {
  type?:
    | "agent_start"
    | "agent_end"
    | "turn_start"
    | "turn_end"
    | "message_start"
    | "message_update"
    | "message_end"
    | "tool_execution_start"
    | "tool_execution_update"
    | "tool_execution_end"
    | "queue_update"
    | "compaction_start"
    | "compaction_end"
    | "auto_retry_start"
    | "auto_retry_end"
    | "extension_error"
    | "extension_ui_request"
    | "response"
    | "stderr"
    | "process_error"
    | "process_exit";
};

export interface PiToolSnapshot {
  id: string;
  name: string;
  args: unknown;
  output: string;
  status: PiToolStatus;
}

export function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function getAssistantEvent(event: PiRpcEvent): PiAssistantEvent | null {
  return readRecord(event.assistantMessageEvent) as PiAssistantEvent | null;
}

export function getContentIndex(event: PiAssistantEvent): number | undefined {
  return readNumber(event.contentIndex);
}

export function extractTextContent(value: unknown): string {
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

export function normalizePiError(event: PiRpcEvent | PiAssistantEvent): string {
  const responseMessage = readString(readRecord(event.error)?.message) || readString(event.error);
  return readString(event.message) || readString(event.error) || responseMessage || `${event.type ?? "pi_error"}`;
}

export function extractToolCall(value: unknown): Partial<PiToolSnapshot> & { id?: string } {
  const record = readRecord(value);
  if (!record) return {};
  return {
    id: readString(record.id),
    name: readString(record.name),
    args: record.arguments ?? record.args ?? null,
  };
}

export function toolSnapshotFromExecutionEvent(
  event: PiRpcEvent,
  status: PiToolStatus,
  resultField?: "partialResult" | "result",
): PiToolSnapshot {
  return {
    id: readString(event.toolCallId),
    name: readString(event.toolName) || "tool",
    args: event.args ?? null,
    output: resultField ? extractTextContent(event[resultField]) : "",
    status,
  };
}

export function isPiRpcResponse(event: PiRpcEvent): event is PiRpcEvent & {
  id?: string;
  command?: string;
  success: boolean;
  data?: unknown;
  error?: unknown;
} {
  return event.type === "response" && typeof event.success === "boolean";
}

export function getPiResponseError(event: PiRpcEvent): string {
  return readString(event.error) || normalizePiError(event);
}

export function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

export function getPermissionModeFromStatus(value: unknown): PiPermissionMode | null {
  const text = stripAnsi(readString(value)).toLowerCase();
  if (text.includes("bypass permissions")) return "bypassPermissions";
  if (text.includes("default")) return "default";
  return null;
}

export function getPiTabStatusForEvent(event: PiRpcEvent): TabStatus | null | undefined {
  switch (event.type) {
    case "agent_start":
    case "message_start":
    case "message_update":
    case "tool_execution_start":
    case "tool_execution_update":
    case "compaction_start":
    case "auto_retry_start":
      return "thinking";
    case "agent_end":
    case "turn_end":
    case "message_end":
    case "tool_execution_end":
    case "process_exit":
    case "compaction_end":
    case "auto_retry_end":
      return null;
    case "response":
      return event.success === false ? null : undefined;
    default:
      return undefined;
  }
}
