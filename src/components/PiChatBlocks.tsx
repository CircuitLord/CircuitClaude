import {
  activeAggregateToolItem,
  aggregateToolLabel,
  compactToolOutputPreview,
  finalizedAggregateToolLabel,
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
        <pre className="pi-chat-user-text">{getMessageText(message.blocks)}</pre>
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
      return <pre className="pi-chat-text">{block.content}</pre>;

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
  const aggregate = block.aggregate;
  const activeItem = aggregate ? activeAggregateToolItem(aggregate) : undefined;
  const title = aggregate
    ? aggregate.finalized ? finalizedAggregateToolLabel(aggregate) : aggregateToolLabel(aggregate)
    : toolDisplayLabel(block.name);
  const args = aggregate ? undefined : summarizeToolArgs(block.name, block.args);
  const outputPreview = block.status === "error" ? compactToolOutputPreview(block.output) : [];

  return (
    <div className={`pi-chat-tool pi-chat-tool--${block.status}${aggregate ? " pi-chat-tool--aggregate" : ""}`}>
      <div className="pi-chat-tool-line">
        <span className="pi-chat-tool-dot" aria-hidden="true" />
        <span className="pi-chat-tool-title">{title}</span>
        {args !== undefined && (
          <>
            <span className="pi-chat-tool-paren">(</span>
            <span className="pi-chat-tool-arg">{args}</span>
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
      {outputPreview.length > 0 && (
        <pre className="pi-chat-tool-output">{outputPreview.join("\n")}</pre>
      )}
    </div>
  );
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
