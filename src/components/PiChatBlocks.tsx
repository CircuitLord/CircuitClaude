import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  activeAggregateToolItem,
  aggregateToolLabel,
  compactToolOutputPreview,
  finalizedAggregateToolLabel,
  formatToolDuration,
  summarizeToolArgs,
  toolDisplayLabel,
  updateToolFilePatches,
  aggregateUpdateToolFilePatches,
  combinedUpdateToolPatchStats,
  renderCombinedUpdateToolPatchDiff,
  renderUpdateToolPatchDiff,
  type UpdateToolPatchHunk,
} from "../lib/piToolDisplay";
import { readFile, fileColorClass } from "../lib/files";
import { useGitStore } from "../stores/gitStore";
import type { PiChatBlock, PiChatMessage } from "../stores/piChatStore";

interface PiChatMessageViewProps {
  message: PiChatMessage;
  projectPath: string;
  changeSummary?: ChangedFilesBundle;
}

export interface ChangedFileSummary {
  path: string;
  additions: number;
  removals: number;
}

export interface ChangedFilesCollection {
  files: ChangedFileSummary[];
  hunks: Record<string, UpdateToolPatchHunk[]>;
}

export interface ChangedFilesBundle {
  files: ChangedFileSummary[];
  turnHunks: Record<string, UpdateToolPatchHunk[]>;
  sessionHunks: Record<string, UpdateToolPatchHunk[]>;
}

const ChangedFilesIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 5v14" />
    <path d="M5 12h14" />
    <rect x="4" y="4" width="16" height="16" rx="3" />
  </svg>
);

export function PiChatMessageView({ message, projectPath, changeSummary }: PiChatMessageViewProps) {
  if (message.role === "user") {
    return (
      <div className="pi-chat-message pi-chat-message--user">
        <div className="pi-chat-user-text">{renderPiMarkdownBlocks(getMessageText(message.blocks), "pi-user")}</div>
      </div>
    );
  }

  if (!message.blocks.some(isVisibleBlock)) return null;

  return (
    <div className="pi-chat-message pi-chat-message--assistant">
      {message.blocks.map((block, index) => (
        <PiBlockView block={block} key={getBlockKey(block, index)} />
      ))}
      {changeSummary && changeSummary.files.length > 0 && <PiChangedFilesCard summary={changeSummary} projectPath={projectPath} />}
    </div>
  );
}

function joinProjectPath(projectPath: string, filePath: string): string {
  return `${projectPath.replace(/[\\/]+$/, "")}/${filePath.replace(/^[\\/]+/, "")}`;
}

function PiChangedFilesCard({ summary, projectPath }: { summary: ChangedFilesBundle; projectPath: string }) {
  const fetchStatus = useGitStore((state) => state.fetchStatus);
  const openDiff = useGitStore((state) => state.openDiff);
  const files = summary.files;
  const fileKey = useMemo(() => files.map((file) => file.path).join("\0"), [files]);
  const hunkKey = useMemo(
    () => files.map((file) => `${file.path}:${(summary.turnHunks[file.path] ?? []).map((hunk) => `${hunk.oldText.length}/${hunk.newText.length}`).join(",")}`).join("\0"),
    [files, summary.turnHunks],
  );
  const [turnStats, setTurnStats] = useState<ChangedFileSummary[] | null>(null);
  const displayFiles = turnStats ?? files;
  const totalAdditions = turnStats?.reduce((sum, file) => sum + file.additions, 0);
  const totalRemovals = turnStats?.reduce((sum, file) => sum + file.removals, 0);

  useEffect(() => {
    let cancelled = false;
    setTurnStats(null);

    async function loadTurnStats() {
      const stats = await Promise.all(files.map(async (file) => {
        const currentText = await readFile(joinProjectPath(projectPath, file.path)).catch(() => "");
        const fileStats = combinedUpdateToolPatchStats(summary.turnHunks[file.path] ?? [], currentText);
        return { path: file.path, additions: fileStats.additions, removals: fileStats.removals };
      }));
      if (!cancelled) setTurnStats(stats);
    }

    loadTurnStats().catch(() => {
      if (!cancelled) setTurnStats(files.map((file) => ({ path: file.path, additions: file.additions, removals: file.removals })));
    });

    return () => {
      cancelled = true;
    };
  }, [fileKey, hunkKey, projectPath]);

  const openFileDiff = async (file: ChangedFileSummary) => {
    await fetchStatus(projectPath);
    const status = useGitStore.getState().statuses[projectPath];
    const fileKey = file.path.toLowerCase();
    const entry = status?.files.find((candidate) => normalizeGitPath(candidate.path).toLowerCase() === fileKey);
    const currentText = await readFile(joinProjectPath(projectPath, file.path)).catch(() => "");
    await openDiff(projectPath, entry ?? { path: file.path, status: "M" }, {
      defaultMode: "turn",
      turnContent: renderUpdateToolPatchDiff(file.path, summary.turnHunks[file.path] ?? [], currentText),
      sessionContent: renderCombinedUpdateToolPatchDiff(file.path, summary.sessionHunks[file.path] ?? [], currentText),
    });
  };

  return (
    <div className="pi-chat-changes-card">
      <div className="pi-chat-changes-header">
        <div className="pi-chat-changes-icon">{ChangedFilesIcon}</div>
        <div className="pi-chat-changes-title">
          <span>Edited {files.length} {files.length === 1 ? "file" : "files"}</span>
          <span className="pi-chat-changes-total">
            {turnStats ? (
              <>
                <span className="pi-chat-change-add">+{totalAdditions}</span>
                <span className="pi-chat-change-del"> -{totalRemovals}</span>
              </>
            ) : (
              <span className="pi-chat-change-loading">checking diff…</span>
            )}
          </span>
        </div>
        <button type="button" className="pi-chat-changes-review" onClick={() => openFileDiff(files[0])}>
          Review
        </button>
      </div>
      <div className="pi-chat-changes-files">
        {displayFiles.map((file) => (
          <button
            type="button"
            className="pi-chat-changes-file"
            key={file.path}
            title={`Open diff for ${file.path}`}
            onClick={() => openFileDiff(file)}
          >
            <span className="pi-chat-changes-path">
              {(() => {
                const slash = Math.max(file.path.lastIndexOf("/"), file.path.lastIndexOf("\\"));
                const dir = slash >= 0 ? file.path.slice(0, slash + 1) : "";
                const name = slash >= 0 ? file.path.slice(slash + 1) : file.path;
                return (
                  <>
                    {dir && <span className="pi-chat-changes-dir">{dir}</span>}
                    <span className={`pi-chat-changes-name ${fileColorClass(name)}`}>{name}</span>
                  </>
                );
              })()}
            </span>
            <span className="pi-chat-changes-stat">
              {turnStats ? (
                <>
                  <span className="pi-chat-change-add">+{file.additions}</span>
                  <span className="pi-chat-change-del">-{file.removals}</span>
                </>
              ) : (
                <span className="pi-chat-change-loading">…</span>
              )}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function isVisibleBlock(block: PiChatBlock): boolean {
  if (block.type === "thinking") return false;
  return block.type !== "tool" || block.hidden !== true;
}

export function PiBlockView({ block }: { block: PiChatBlock }) {
  switch (block.type) {
    case "text":
      return <div className="pi-chat-text">{renderPiMarkdownBlocks(block.content, `pi-text-${block.contentIndex ?? 0}`)}</div>;

    case "thinking":
      return null;

    case "tool":
      return block.hidden ? null : <PiToolBlockView block={block} />;

    case "error":
      return (
        <div className="pi-chat-error">
          <span>error: </span>{block.content}
        </div>
      );
  }
}

function PiToolBlockView({ block }: { block: Extract<PiChatBlock, { type: "tool" }> }) {
  if (block.name === "bash" && !block.aggregate) return <PiBashBlockView block={block} />;

  const aggregate = block.aggregate;
  const activeItem = aggregate ? activeAggregateToolItem(aggregate) : undefined;
  const activeDetail = activeItem && !aggregate?.finalized && activeItem.kind !== "create" && activeItem.kind !== "edit"
    ? activeItem.target
    : undefined;
  const title = aggregate
    ? aggregate.finalized ? finalizedAggregateToolLabel(aggregate) : aggregateToolLabel(aggregate)
    : toolDisplayLabel(block.name);
  const args = aggregate ? undefined : summarizeToolArgs(block.name, block.args);
  const outputPreview = !aggregate && (block.name === "bash" || block.status === "error")
    ? compactToolOutputPreview(block.output)
    : undefined;
  const hasOutputPreview = outputPreview !== undefined
    && (outputPreview.lines.length > 0 || block.name === "bash" || block.status === "error");

  return (
    <div className={`pi-chat-tool pi-chat-tool--${block.status}${aggregate ? " pi-chat-tool--aggregate" : ""}${hasOutputPreview ? " pi-chat-tool--with-output" : ""}`}>
      <div className="pi-chat-tool-line">
        <span className="pi-chat-tool-dot" aria-hidden="true" />
        <span className="pi-chat-tool-title">{title}</span>
        {args !== undefined && (
          <>
            <span className="pi-chat-tool-paren">(</span>
            <span className="pi-chat-tool-arg">{renderToolArg(block.name, args)}</span>
            <span className="pi-chat-tool-paren">)</span>
          </>
        )}
      </div>
      {activeDetail && (
        <div className="pi-chat-tool-detail">
          <span className="pi-chat-tool-caret">⎿</span>
          <span className="pi-chat-tool-target">{activeDetail}</span>
        </div>
      )}
      {hasOutputPreview && outputPreview && (
        <pre className={`pi-chat-tool-output${block.status === "error" ? " pi-chat-tool-output--error" : ""}`}>
          {renderToolOutputPreview(outputPreview, getToolOutputEmptyText(block))}
        </pre>
      )}
    </div>
  );
}

function PiBashBlockView({ block }: { block: Extract<PiChatBlock, { type: "tool" }> }) {
  const command = summarizeToolArgs("bash", block.args);
  const outputPreview = compactToolOutputPreview(block.output);
  const isError = block.status === "error";
  const duration = formatToolDuration(block.durationMs);
  const totalLines = outputPreview.totalLines;
  const outputBody = outputPreview.lines.length > 0
    ? outputPreview.lines.join("\n")
    : getToolOutputEmptyText(block);

  return (
    <div className={`pi-chat-bash pi-chat-bash--${block.status}`}>
      <div className="pi-chat-bash-bar">
        <span className="pi-chat-bash-dot" aria-hidden="true" />
        <span className="pi-chat-bash-name">bash</span>
        <span className="pi-chat-bash-meta">
          {totalLines > 0 && (
            <span className="pi-chat-bash-lines">{totalLines} {totalLines === 1 ? "line" : "lines"}</span>
          )}
          <span className="pi-chat-bash-status" aria-hidden="true" />
          {duration && <span className="pi-chat-bash-duration">{duration}</span>}
        </span>
      </div>
      <div className="pi-chat-bash-body">
        <div className="pi-chat-bash-cmd">
          <span className="pi-chat-bash-sigil">$</span>
          <span className="pi-chat-bash-cmd-text">{command}</span>
        </div>
        <pre className={`pi-chat-bash-out${isError ? " pi-chat-bash-out--error" : ""}`}>
          {outputBody}
        </pre>
      </div>
    </div>
  );
}

function getToolOutputEmptyText(block: Extract<PiChatBlock, { type: "tool" }>): string {
  if (block.name !== "bash") return "Tool failed with no output";
  if (block.status === "pending" || block.status === "running") return "Running…";
  return block.status === "error" ? "Command failed with no output" : "No output";
}

function renderToolOutputPreview(preview: ReturnType<typeof compactToolOutputPreview>, emptyText: string): string {
  const rows = preview.lines.length > 0 ? [...preview.lines] : [`⎿ ${emptyText}`];
  if (preview.hiddenCount > 0) rows.push(`… ${preview.hiddenCount} earlier ${preview.hiddenCount === 1 ? "line" : "lines"} hidden`);
  return rows.join("\n");
}

function renderToolArg(name: string, args: string) {
  if (name !== "edit" && name !== "write") return args;

  const match = args.match(/^(.*?)( \+\d+)( -\d+)$/);
  if (!match) return args;

  return (
    <>
      {match[1]}
      <span className="pi-chat-tool-additions">{match[2]}</span>
      <span className="pi-chat-tool-removals">{match[3]}</span>
    </>
  );
}

function renderPiMarkdownBlocks(text: string, keyPrefix = "pi-text"): ReactNode[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    if (lines[index]?.trim() === "") {
      index += 1;
      continue;
    }

    const fence = lines[index]?.match(/^\s*```[^`]*\s*$/);
    if (fence) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index] ?? "")) {
        codeLines.push(lines[index] ?? "");
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(
        <pre className="pi-chat-code-block" key={`${keyPrefix}-code-block-${blocks.length}`}>
          {codeLines.join("\n")}
        </pre>,
      );
      continue;
    }

    const listItems: string[] = [];
    while (index < lines.length) {
      const match = lines[index]?.match(/^\s*(?:[-*•])\s+(.+)$/);
      if (!match) break;
      listItems.push(match[1]);
      index += 1;
    }
    if (listItems.length > 0) {
      blocks.push(
        <ul className="pi-chat-list" key={`${keyPrefix}-list-${blocks.length}`}>
          {listItems.map((item, itemIndex) => (
            <li key={`${keyPrefix}-list-${blocks.length}-${itemIndex}`}>{renderPiInlineText(item, `${keyPrefix}-li-${blocks.length}-${itemIndex}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length) {
      const line = lines[index] ?? "";
      if (line.trim() === "" || /^\s*```/.test(line) || /^\s*(?:[-*•])\s+/.test(line)) break;
      paragraphLines.push(line.trim());
      index += 1;
    }

    blocks.push(
      <p className="pi-chat-paragraph" key={`${keyPrefix}-p-${blocks.length}`}>
        {renderPiInlineText(paragraphLines.join(" "), `${keyPrefix}-p-${blocks.length}`)}
      </p>,
    );
  }

  return blocks;
}

function renderPiInlineText(text: string, keyPrefix = "pi-text"): ReactNode[] {
  const nodes: ReactNode[] = [];
  let plainStart = 0;
  let index = 0;

  function flushPlain(end: number) {
    if (end > plainStart) nodes.push(text.slice(plainStart, end));
  }

  while (index < text.length) {
    if (text[index] === "`") {
      const end = text.indexOf("`", index + 1);
      if (end !== -1) {
        flushPlain(index);
        nodes.push(
          <code className="pi-chat-inline-code" key={`${keyPrefix}-code-${nodes.length}`}>
            {text.slice(index + 1, end)}
          </code>,
        );
        index = end + 1;
        plainStart = index;
        continue;
      }
    }

    if (text.startsWith("**", index)) {
      const end = text.indexOf("**", index + 2);
      if (end !== -1) {
        flushPlain(index);
        nodes.push(
          <strong className="pi-chat-strong" key={`${keyPrefix}-strong-${nodes.length}`}>
            {renderPiInlineText(text.slice(index + 2, end), `${keyPrefix}-strong-${nodes.length}`)}
          </strong>,
        );
        index = end + 2;
        plainStart = index;
        continue;
      }
    }

    index += 1;
  }

  flushPlain(text.length);
  return nodes;
}

function getMessageText(blocks: PiChatBlock[]): string {
  const first = blocks[0];
  return first?.type === "text" ? first.content : "";
}

function normalizeGitPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function normalizeChangedPath(path: string, projectPath: string): string {
  const normalizedPath = normalizeGitPath(path);
  const normalizedProject = normalizeGitPath(projectPath).replace(/\/+$/, "");
  const lowerPath = normalizedPath.toLowerCase();
  const lowerProject = normalizedProject.toLowerCase();

  if (lowerPath.startsWith(`${lowerProject}/`)) {
    return normalizedPath.slice(normalizedProject.length + 1);
  }

  return normalizedPath;
}

export function changedFilesForMessages(messages: PiChatMessage[], projectPath: string): ChangedFilesCollection {
  const changedFiles = new Map<string, ChangedFileSummary>();
  const hunks: Record<string, UpdateToolPatchHunk[]> = {};

  for (const message of messages) {
    if (message.role !== "assistant") continue;

    for (const block of message.blocks) {
      if (block.type !== "tool") continue;

      const patches = block.aggregate
        ? aggregateUpdateToolFilePatches(block.aggregate)
        : block.status === "done" ? updateToolFilePatches(block.name, block.args) : [];

      for (const patch of patches) {
        const path = normalizeChangedPath(patch.path, projectPath);
        const existing = changedFiles.get(path);
        if (existing) {
          existing.additions += patch.additions;
          existing.removals += patch.removals;
        } else {
          changedFiles.set(path, { path, additions: patch.additions, removals: patch.removals });
        }
        hunks[path] = [...(hunks[path] ?? []), ...patch.hunks];
      }
    }
  }

  return { files: [...changedFiles.values()], hunks };
}

function getBlockKey(block: PiChatBlock, index: number): string {
  if (block.type === "tool") return `tool-${block.id}`;
  if ("contentIndex" in block && block.contentIndex !== undefined) return `${block.type}-${block.contentIndex}`;
  return `${block.type}-${index}`;
}
