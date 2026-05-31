import type { TabStatus } from "../types";

export type PiToolStatus = "pending" | "running" | "done" | "error";

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
  return readString(event.message) || responseMessage || `${event.type ?? "pi_error"}`;
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
