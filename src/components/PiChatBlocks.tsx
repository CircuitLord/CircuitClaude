import type { ReactNode } from "react";
import {
  activeAggregateToolItem,
  aggregateToolLabel,
  compactToolOutputPreview,
  finalizedAggregateToolLabel,
  formatToolDuration,
  summarizeToolArgs,
  toolDisplayLabel,
} from "../lib/piToolDisplay";
import type { PiChatBlock, PiChatMessage } from "../stores/piChatStore";

interface PiChatMessageViewProps {
  message: PiChatMessage;
}

export function PiChatMessageView({ message }: PiChatMessageViewProps) {
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
    </div>
  );
}

function isVisibleBlock(block: PiChatBlock): boolean {
  return block.type !== "tool" || block.hidden !== true;
}

export function PiBlockView({ block }: { block: PiChatBlock }) {
  switch (block.type) {
    case "text":
      return <div className="pi-chat-text">{renderPiMarkdownBlocks(block.content, `pi-text-${block.contentIndex ?? 0}`)}</div>;

    case "thinking":
      return (
        <details className="pi-chat-fold">
          <summary className="pi-chat-fold-title">
            <span className="pi-chat-fold-marker">~</span>
            <span>thinking</span>
          </summary>
          <pre className="pi-chat-thinking">{block.content}</pre>
        </details>
      );

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
      {activeItem && !aggregate?.finalized && (
        <div className="pi-chat-tool-detail">
          <span className="pi-chat-tool-caret">⎿</span>
          <span className="pi-chat-tool-target">{activeItem.target}</span>
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

function getBlockKey(block: PiChatBlock, index: number): string {
  if (block.type === "tool") return `tool-${block.id}`;
  if ("contentIndex" in block && block.contentIndex !== undefined) return `${block.type}-${block.contentIndex}`;
  return `${block.type}-${index}`;
}
