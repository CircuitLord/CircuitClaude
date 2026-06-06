import type { PiToolStatus } from "./piRpc";
import { readRecord } from "./piRpc";

export type PiToolAggregateKind = "read" | "list" | "search" | "create" | "edit";

export interface PiToolAggregateMeta {
  kind: PiToolAggregateKind;
  key: string;
  target: string;
}

export interface PiToolAggregateItem extends PiToolAggregateMeta {
  id: string;
  status: PiToolStatus;
  toolName?: string;
  args?: unknown;
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
  if (name === "write") {
    const path = readToolPath(args);
    return { kind: "create", key: path ? `create:${path}` : `pending-write:${toolCallId}`, target: shortToolPath(path) };
  }
  if (name === "edit") {
    const path = readToolPath(args);
    return { kind: "edit", key: path ? `edit:${path}` : `pending-edit:${toolCallId}`, target: shortToolPath(path) };
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

function isMutationAggregateKind(kind: PiToolAggregateKind): boolean {
  return kind === "create" || kind === "edit";
}

function hasMutationItems(aggregate: PiToolAggregate): boolean {
  return aggregate.items.some((item) => isMutationAggregateKind(item.kind));
}

export function canMergeAggregateTool(aggregate: PiToolAggregate, meta: PiToolAggregateMeta): boolean {
  const incomingIsMutation = isMutationAggregateKind(meta.kind);
  return aggregate.items.every((item) => isMutationAggregateKind(item.kind) === incomingIsMutation);
}

function textLinesForDiff(text: string): string[] {
  if (text.length === 0) return [];
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function lcsLength(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;

  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  let previous = new Array(shorter.length + 1).fill(0);
  let current = new Array(shorter.length + 1).fill(0);

  for (const longerLine of longer) {
    for (let i = 1; i <= shorter.length; i += 1) {
      current[i] = longerLine === shorter[i - 1]
        ? previous[i - 1] + 1
        : Math.max(previous[i], current[i - 1]);
    }
    [previous, current] = [current, previous];
    current.fill(0);
  }

  return previous[shorter.length];
}

function changedLineStats(oldText: string, newText: string): { additions: number; removals: number } {
  const oldLines = textLinesForDiff(oldText);
  const newLines = textLinesForDiff(newText);
  const shared = lcsLength(oldLines, newLines);
  return {
    additions: newLines.length - shared,
    removals: oldLines.length - shared,
  };
}

function readText(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readToolPath(args: Record<string, unknown>): string | undefined {
  const path = args.path ?? args.filePath ?? args.file_path;
  return typeof path === "string" && path.length > 0 ? path : undefined;
}

export interface UpdateToolFileStat {
  path: string;
  additions: number;
  removals: number;
}

export interface UpdateToolPatchHunk {
  oldText: string;
  newText: string;
  label: string;
}

export interface UpdateToolFilePatch extends UpdateToolFileStat {
  diff: string;
  hunks: UpdateToolPatchHunk[];
}

function normalizeText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function lineNumberAtIndex(text: string, index: number): number {
  return normalizeText(text.slice(0, Math.max(0, index))).split("\n").length;
}

function unifiedRange(start: number, lineCount: number): string {
  if (lineCount === 0) return `${Math.max(0, start - 1)},0`;
  return lineCount === 1 ? String(Math.max(1, start)) : `${Math.max(1, start)},${lineCount}`;
}

function unifiedHunk(oldText: string, newText: string, label: string, oldStart = 1, newStart = 1): string {
  const oldLines = textLinesForDiff(oldText);
  const newLines = textLinesForDiff(newText);
  const lines = [`@@ -${unifiedRange(oldStart, oldLines.length)} +${unifiedRange(newStart, newLines.length)} @@ ${label}`];
  lines.push(...oldLines.map((line) => `-${line}`));
  lines.push(...newLines.map((line) => `+${line}`));
  return `${lines.join("\n")}\n`;
}

interface LineDiffOp {
  type: "context" | "add" | "del";
  line: string;
  oldNum: number | null;
  newNum: number | null;
  oldCursor: number;
  newCursor: number;
}

function lineDiffOps(oldLines: string[], newLines: string[]): LineDiffOp[] {
  const dp = Array.from({ length: oldLines.length + 1 }, () => new Uint32Array(newLines.length + 1));

  for (let i = oldLines.length - 1; i >= 0; i -= 1) {
    for (let j = newLines.length - 1; j >= 0; j -= 1) {
      dp[i][j] = oldLines[i] === newLines[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const ops: LineDiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < oldLines.length || j < newLines.length) {
    const oldCursor = i + 1;
    const newCursor = j + 1;
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      ops.push({ type: "context", line: oldLines[i], oldNum: oldCursor, newNum: newCursor, oldCursor, newCursor });
      i += 1;
    j += 1;
    } else if (j < newLines.length && (i === oldLines.length || dp[i][j + 1] >= dp[i + 1][j])) {
      ops.push({ type: "add", line: newLines[j], oldNum: null, newNum: newCursor, oldCursor, newCursor });
      j += 1;
    } else if (i < oldLines.length) {
      ops.push({ type: "del", line: oldLines[i], oldNum: oldCursor, newNum: null, oldCursor, newCursor });
      i += 1;
    }
  }

  return ops;
}

function hunkStart(ops: LineDiffOp[], side: "old" | "new"): number {
  const key = side === "old" ? "oldNum" : "newNum";
  const cursorKey = side === "old" ? "oldCursor" : "newCursor";
  const firstNumbered = ops.find((op) => op[key] !== null)?.[key];
  return firstNumbered ?? ops[0]?.[cursorKey] ?? 1;
}

function unifiedDiffFromTexts(path: string, oldText: string, newText: string): string {
  const oldLines = textLinesForDiff(oldText);
  const newLines = textLinesForDiff(newText);
  const ops = lineDiffOps(oldLines, newLines);
  const context = 3;
  const hunks: string[] = [];
  let index = 0;

  while (index < ops.length) {
    while (index < ops.length && ops[index].type === "context") index += 1;
    if (index >= ops.length) break;

    const start = Math.max(0, index - context);
    let end = index;
    let lastChange = index;

    while (end < ops.length) {
      if (ops[end].type !== "context") lastChange = end;
      if (end - lastChange >= context) break;
      end += 1;
    }

    const hunkOps = ops.slice(start, Math.min(ops.length, lastChange + context + 1));
    const oldCount = hunkOps.filter((op) => op.oldNum !== null).length;
    const newCount = hunkOps.filter((op) => op.newNum !== null).length;
    const oldStart = hunkStart(hunkOps, "old");
    const newStart = hunkStart(hunkOps, "new");
    const lines = [`@@ -${unifiedRange(oldStart, oldCount)} +${unifiedRange(newStart, newCount)} @@`];
    for (const op of hunkOps) {
      lines.push(`${op.type === "add" ? "+" : op.type === "del" ? "-" : " "}${op.line}`);
    }
    hunks.push(`${lines.join("\n")}\n`);
    index = Math.min(ops.length, lastChange + context + 1);
  }

  return `--- a/${shortToolPath(path)}\n+++ b/${shortToolPath(path)}\n${hunks.join("")}`;
}

function unifiedDiffHasChanges(diff: string): boolean {
  let inHunk = false;
  for (const line of diff.split("\n")) {
    if (line.startsWith("@@")) {
      inHunk = true;
      continue;
    }
    if (inHunk && (line.startsWith("-") || line.startsWith("+"))) return true;
  }
  return false;
}

function reverseApplyHunks(currentText: string, hunks: UpdateToolPatchHunk[]): { text: string; complete: boolean } {
  let text = normalizeText(currentText);
  let complete = true;

  if (text.length === 0 && hunks.length === 1) {
    const oldText = normalizeText(hunks[0].oldText);
    const newText = normalizeText(hunks[0].newText);
    if (oldText.length > 0 && newText.length === 0) return { text: oldText, complete: true };
  }

  for (let index = hunks.length - 1; index >= 0; index -= 1) {
    const hunk = hunks[index];
    const newText = normalizeText(hunk.newText);
    const oldText = normalizeText(hunk.oldText);
    if (newText.length === 0) {
      complete = false;
      continue;
    }

    const at = text.lastIndexOf(newText);
    if (at === -1) {
      complete = false;
      continue;
    }
    text = `${text.slice(0, at)}${oldText}${text.slice(at + newText.length)}`;
  }

  return { text, complete };
}

function fallbackHunkStats(hunks: UpdateToolPatchHunk[]): { additions: number; removals: number } {
  return hunks.reduce(
    (total, hunk) => {
      const stats = changedLineStats(hunk.oldText, hunk.newText);
      return {
        additions: total.additions + stats.additions,
        removals: total.removals + stats.removals,
      };
    },
    { additions: 0, removals: 0 },
  );
}

export function combinedUpdateToolPatchStats(hunks: UpdateToolPatchHunk[], currentText = ""): { additions: number; removals: number } {
  if (hunks.length === 0) return { additions: 0, removals: 0 };
  const previous = reverseApplyHunks(currentText, hunks);
  return previous.complete
    ? changedLineStats(previous.text, normalizeText(currentText))
    : fallbackHunkStats(hunks);
}

export function renderCombinedUpdateToolPatchDiff(path: string, hunks: UpdateToolPatchHunk[], currentText = ""): string {
  if (hunks.length === 0) return "";
  const previous = reverseApplyHunks(currentText, hunks);
  if (previous.complete) {
    const combined = unifiedDiffFromTexts(path, previous.text, normalizeText(currentText));
    if (unifiedDiffHasChanges(combined)) return combined;
  }
  return renderUpdateToolPatchDiff(path, hunks, currentText);
}

export function renderUpdateToolPatchDiff(path: string, hunks: UpdateToolPatchHunk[], currentText = ""): string {
  if (hunks.length === 0) return "";
  const normalizedCurrent = normalizeText(currentText);
  let searchFrom = 0;
  let cumulativeDelta = 0;
  let fallbackStart = 1;
  const rendered: string[] = [];

  for (const hunk of hunks) {
    const newNeedle = normalizeText(hunk.newText);
    const oldNeedle = normalizeText(hunk.oldText);
    const needle = newNeedle || oldNeedle;
    const foundAt = needle ? normalizedCurrent.indexOf(needle, searchFrom) : -1;
    const newStart = foundAt === -1 ? fallbackStart : lineNumberAtIndex(normalizedCurrent, foundAt);
    const oldStart = Math.max(1, newStart - cumulativeDelta);
    const oldLineCount = textLinesForDiff(hunk.oldText).length;
    const newLineCount = textLinesForDiff(hunk.newText).length;

    rendered.push(unifiedHunk(hunk.oldText, hunk.newText, hunk.label, oldStart, newStart));
    cumulativeDelta += newLineCount - oldLineCount;
    fallbackStart = Math.max(1, newStart + Math.max(1, newLineCount));
    if (foundAt !== -1) searchFrom = foundAt + needle.length;
  }

  return `--- a/${shortToolPath(path)}\n+++ b/${shortToolPath(path)}\n${rendered.join("")}`;
}

export function updateToolFilePatches(name: string, rawArgs: unknown): UpdateToolFilePatch[] {
  const args = asRecord(rawArgs);
  const path = readToolPath(args);
  if (!path) return [];

  if (name === "write") {
    const content = readText(args.content ?? args.contents);
    if (content === undefined) return [];
    const stats = changedLineStats("", content);
    const hunks = [{ oldText: "", newText: content, label: "write" }];
    return [{
      path,
      additions: stats.additions,
      removals: stats.removals,
      diff: renderUpdateToolPatchDiff(path, hunks, content),
      hunks,
    }];
  }

  if (name !== "edit") return [];

  const edits = Array.isArray(args.edits) ? args.edits : [args];
  const hunks: UpdateToolPatchHunk[] = [];
  let additions = 0;
  let removals = 0;

  for (const [index, edit] of edits.entries()) {
    const record = asRecord(edit);
    const oldText = readText(record.oldText ?? record.old_text);
    const newText = readText(record.newText ?? record.new_text);
    if (oldText === undefined || newText === undefined) continue;

    const stat = changedLineStats(oldText, newText);
    additions += stat.additions;
    removals += stat.removals;
    hunks.push({ oldText, newText, label: edits.length > 1 ? `edit ${index + 1}` : "edit" });
  }

  return hunks.length > 0
    ? [{ path, additions, removals, diff: renderUpdateToolPatchDiff(path, hunks), hunks }]
    : [];
}

export function aggregateUpdateToolFilePatches(aggregate: PiToolAggregate): UpdateToolFilePatch[] {
  return aggregate.items.flatMap((item) => {
    if (item.status !== "done" || !item.toolName) return [];
    return updateToolFilePatches(item.toolName, item.args);
  });
}

export function updateToolFileStats(name: string, rawArgs: unknown): UpdateToolFileStat[] {
  return updateToolFilePatches(name, rawArgs).map(({ path, additions, removals }) => ({ path, additions, removals }));
}

function updateToolStats(name: string, args: Record<string, unknown>): { additions: number; removals: number } | undefined {
  const stats = updateToolFileStats(name, args);
  if (stats.length === 0) return undefined;
  return stats.reduce(
    (total, stat) => ({
      additions: total.additions + stat.additions,
      removals: total.removals + stat.removals,
    }),
    { additions: 0, removals: 0 },
  );
}

function summarizeUpdateToolArgs(name: string, args: Record<string, unknown>): string {
  const path = shortToolPath(args.path ?? args.file_path);
  const stats = updateToolStats(name, args);
  const suffix = stats ? ` +${stats.additions} -${stats.removals}` : "";
  return `${clampToolText(path, MAX_ARG_LENGTH - suffix.length)}${suffix}`;
}

function successfulAggregateCount(aggregate: PiToolAggregate, kind: PiToolAggregateKind): number {
  return new Set(aggregate.items.filter((item) => item.kind === kind && item.status === "done").map((item) => item.key)).size;
}

function mutationProgressLabel(aggregate: PiToolAggregate): string {
  const active = activeAggregateToolItem(aggregate);
  if (!active) return "Updating files";
  const verb = active.kind === "create" ? "Creating" : "Editing";
  return `${verb} ${clampToolText(active.target)}`;
}

function mutationFinalLabel(aggregate: PiToolAggregate): string {
  const createdCount = successfulAggregateCount(aggregate, "create");
  const editedCount = successfulAggregateCount(aggregate, "edit");
  const parts: string[] = [];
  if (createdCount > 0) parts.push(`Created ${createdCount} ${plural(createdCount, "file", "files")}`);
  if (editedCount > 0) parts.push(`${parts.length > 0 ? "edited" : "Edited"} ${editedCount} ${plural(editedCount, "file", "files")}`);
  return parts.join(", ") || "No files changed";
}

export function aggregateToolLabel(aggregate: PiToolAggregate): string {
  if (hasMutationItems(aggregate)) return mutationProgressLabel(aggregate);

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
  if (hasMutationItems(aggregate)) return mutationFinalLabel(aggregate);

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
      return summarizeUpdateToolArgs(name, args);
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

export interface CompactToolOutputPreview {
  lines: string[];
  hiddenCount: number;
  totalLines: number;
}

function stripAnsi(text: string): string {
  return text
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b[ -/]*[@-~]/g, "");
}

function sanitizePreviewLine(line: string): string {
  return stripAnsi(line)
    .replace(/\x08+/g, "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/\t/g, "    ")
    .trimEnd();
}

function isPreviewNoiseLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.length === 0 || /^[\^~_\-=|/\\.*·•]+$/.test(trimmed);
}

export function compactToolOutputPreview(output: string, maxLines = 3): CompactToolOutputPreview {
  const normalized = output.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n$/, "");
  const lines = (normalized ? normalized.split("\n") : [])
    .map(sanitizePreviewLine)
    .filter((line) => !isPreviewNoiseLine(line));
  const hiddenCount = Math.max(0, lines.length - maxLines);
  return {
    lines: lines.slice(-maxLines),
    hiddenCount,
    totalLines: lines.length,
  };
}

export function formatToolDuration(durationMs: number | undefined): string | undefined {
  if (durationMs === undefined || !Number.isFinite(durationMs) || durationMs < 0) return undefined;
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  const seconds = durationMs / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}m ${rest}s`;
}
