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

  return (
    <div className="pi-chat-message pi-chat-message--assistant">
      {message.blocks.map((block, index) => (
        <PiBlockView block={block} key={getBlockKey(block, index)} />
      ))}
    </div>
  );
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
      return (
        <div className={`pi-chat-tool pi-chat-tool--${block.status}`}>
          <div className="pi-chat-tool-header">tool: {block.name} [{block.status}]</div>
          {block.args !== null && block.args !== undefined ? (
            <pre className="pi-chat-tool-body">{formatJson(block.args)}</pre>
          ) : null}
          {block.output ? (
            <pre className="pi-chat-tool-output">{block.output}</pre>
          ) : null}
        </div>
      );

    case "error":
      return (
        <div className="pi-chat-error">
          <span>error: </span>{block.content}
        </div>
      );
  }
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

function formatJson(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
