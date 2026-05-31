import type { PiToolStatus } from "./piRpc";
import { readRecord } from "./piRpc";

export type PiToolAggregateKind = "read" | "list" | "search";

export interface PiToolAggregateMeta {
  kind: PiToolAggregateKind;
  key: string;
  target: string;
}

export interface PiToolAggregateItem extends PiToolAggregateMeta {
  id: string;
  status: PiToolStatus;
}

export interface PiToolAggregate {
  items: PiToolAggregateItem[];
  activeId: string;
  finalized?: boolean;
}

const MAX_ARG_LENGTH = 110;

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      return asRecord(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return readRecord(value) ?? {};
}

function inlineText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function clampToolText(text: string, max = MAX_ARG_LENGTH): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export function shortToolPath(path: unknown, fallback = "…"): string {
  if (typeof path !== "string" || path.length === 0) return fallback;
  return path.replace(/\\/g, "/");
}

function shellWords(command: string): string[] | undefined {
  if (/[\n;&|<>`$()]/.test(command)) return undefined;
  const words = command.match(/"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|\S+/g);
  return words?.map((word) => {
    if ((word.startsWith('"') && word.endsWith('"')) || (word.startsWith("'") && word.endsWith("'"))) {
      return word.slice(1, -1);
    }
    return word;
  });
}

function simpleListCommandTarget(command: unknown): string | undefined {
  if (typeof command !== "string") return undefined;
  const words = shellWords(command.trim());
  if (!words || words.length === 0) return undefined;

  const commandName = words[0].replace(/\\/g, "/").split("/").pop()?.toLowerCase();
  if (commandName !== "ls" && commandName !== "dir") return undefined;

  const isOption = (word: string) => (commandName === "dir" ? word.startsWith("/") || word.startsWith("-") : word.startsWith("-"));
  const targets = words.slice(1).filter((word) => !isOption(word));
  if (targets.length > 1) return undefined;
  return targets[0] ?? ".";
}

export function aggregateToolMeta(name: string, rawArgs: unknown, toolCallId = ""): PiToolAggregateMeta | undefined {
  const args = asRecord(rawArgs);
  if (name === "read") {
    const path = typeof args.path === "string" ? args.path : undefined;
    return { kind: "read", key: path ? `read:${path}` : `pending-read:${toolCallId}`, target: shortToolPath(path) };
  }
  if (name === "grep") {
    const path = typeof args.path === "string" ? args.path : ".";
    const pattern = typeof args.pattern === "string" ? ` /${args.pattern}/` : "";
    const key = typeof args.pattern === "string" ? `search:${path}:${args.pattern}` : `pending-grep:${toolCallId}`;
    return { kind: "search", key, target: `${shortToolPath(path, ".")}${pattern}` };
  }
  if (name === "find") {
    const path = typeof args.path === "string" ? args.path : ".";
    const pattern = typeof args.pattern === "string" ? ` ${args.pattern}` : "";
    const key = typeof args.pattern === "string" ? `search:${path}:${args.pattern}` : `pending-find:${toolCallId}`;
    return { kind: "search", key, target: `${shortToolPath(path, ".")}${pattern}` };
  }
  if (name === "ls") {
    const path = typeof args.path === "string" ? args.path : ".";
    return { kind: "list", key: `list:${path}`, target: shortToolPath(path, ".") };
  }
  if (name === "bash") {
    const target = simpleListCommandTarget(args.command);
    if (target !== undefined) return { kind: "list", key: `list:${target}`, target: shortToolPath(target, ".") };
  }
  return undefined;
}

export function aggregateToolStatus(items: PiToolAggregateItem[]): PiToolStatus {
  if (items.some((item) => item.status === "pending" || item.status === "running")) return "running";
  if (items.some((item) => item.status === "error")) return "error";
  return "done";
}

function aggregateCount(aggregate: PiToolAggregate, kind: PiToolAggregateKind): number {
  return new Set(aggregate.items.filter((item) => item.kind === kind).map((item) => item.key)).size;
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

export function aggregateToolLabel(aggregate: PiToolAggregate): string {
  const readCount = aggregateCount(aggregate, "read");
  const listCount = aggregateCount(aggregate, "list");
  const searchCount = aggregateCount(aggregate, "search");
  const parts: string[] = [];
  if (searchCount > 0) parts.push(`Searching for ${searchCount} ${plural(searchCount, "pattern", "patterns")}`);
  if (readCount > 0) parts.push(`${parts.length > 0 ? "reading" : "Reading"} ${readCount} ${plural(readCount, "file", "files")}`);
  if (listCount > 0) parts.push(`${parts.length > 0 ? "listing" : "Listing"} ${listCount} ${plural(listCount, "directory", "directories")}`);
  return parts.join(", ") || "Inspecting files";
}

export function finalizedAggregateToolLabel(aggregate: PiToolAggregate): string {
  const readCount = aggregateCount(aggregate, "read");
  const listCount = aggregateCount(aggregate, "list");
  const searchCount = aggregateCount(aggregate, "search");
  const parts: string[] = [];
  if (searchCount > 0) parts.push(`Searched for ${searchCount} ${plural(searchCount, "pattern", "patterns")}`);
  if (readCount > 0) parts.push(`${parts.length > 0 ? "read" : "Read"} ${readCount} ${plural(readCount, "file", "files")}`);
  if (listCount > 0) parts.push(`${parts.length > 0 ? "listed" : "Listed"} ${listCount} ${plural(listCount, "directory", "directories")}`);
  return parts.join(", ") || "Inspected files";
}

export function activeAggregateToolItem(aggregate: PiToolAggregate): PiToolAggregateItem | undefined {
  return aggregate.items.find((item) => item.id === aggregate.activeId) ?? aggregate.items[aggregate.items.length - 1];
}

export function toolDisplayLabel(name: string): string {
  switch (name) {
    case "bash":
      return "Bash";
    case "read":
      return "Read";
    case "find":
      return "Find";
    case "grep":
      return "Grep";
    case "ls":
      return "LS";
    case "edit":
    case "write":
      return "Update";
    default:
      return name || "tool";
  }
}

export function summarizeToolArgs(name: string, rawArgs: unknown): string {
  const args = asRecord(rawArgs);
  switch (name) {
    case "bash":
      return clampToolText(typeof args.command === "string" ? inlineText(args.command) : "…");
    case "read": {
      let suffix = "";
      if (args.offset !== undefined || args.limit !== undefined) {
        const start = Number.isFinite(args.offset) ? Number(args.offset) : 1;
        const end = Number.isFinite(args.limit) ? start + Number(args.limit) - 1 : undefined;
        suffix = `:${start}${end ? `-${end}` : ""}`;
      }
      return clampToolText(`${shortToolPath(args.path)}${suffix}`);
    }
    case "find":
      return clampToolText(`${String(args.pattern ?? "…")} in ${shortToolPath(args.path, ".")}`);
    case "grep":
      return clampToolText(`/${String(args.pattern ?? "…")}/ in ${shortToolPath(args.path, ".")}`);
    case "ls":
      return clampToolText(shortToolPath(args.path, "."));
    case "edit":
    case "write":
      return clampToolText(shortToolPath(args.path ?? args.file_path));
    default: {
      const preferred = args.path ?? args.filePath ?? args.file_path ?? args.destinationPath ?? args.url ?? args.command;
      if (typeof preferred === "string" && preferred.length > 0) return clampToolText(preferred);
      const keys = Object.keys(args);
      if (keys.length === 0) return "…";
      const first = keys[0];
      return clampToolText(`${first}: ${String(args[first])}`);
    }
  }
}

export function compactToolOutputPreview(output: string, maxLines = 3): string[] {
  return output
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n$/, "")
    .split("\n")
    .map((line) => line.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").replace(/\t/g, "    ").trimEnd())
    .filter((line) => line.trim().length > 0)
    .slice(-maxLines);
}
