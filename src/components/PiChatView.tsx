import { useCallback, useEffect, useRef, useState } from "react";
import { Channel } from "@tauri-apps/api/core";
import { abortPiSession, createPiSession, destroyPiSession, sendPiMessage } from "../lib/pi";
import { usePiChatStore, PiChatBlock, PiRpcEvent } from "../stores/piChatStore";
import { useSessionStore } from "../stores/sessionStore";

interface PiChatViewProps {
  tabId: string;
  projectPath: string;
}

const EMPTY_MESSAGES = [] as const;

export function PiChatView({ tabId, projectPath }: PiChatViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const backendIdRef = useRef<string | null>(null);
  const initializedRef = useRef(false);
  const [inputValue, setInputValue] = useState("");

  const messages = usePiChatStore(
    useCallback((state) => state.chats.get(tabId) ?? EMPTY_MESSAGES, [tabId]),
  );
  const isStreaming = usePiChatStore(
    useCallback((state) => state.streamingTabs.has(tabId), [tabId]),
  );
  const addUserMessage = usePiChatStore((state) => state.addUserMessage);
  const appendEvent = usePiChatStore((state) => state.appendEvent);
  const appendError = usePiChatStore((state) => state.appendError);
  const removeChat = usePiChatStore((state) => state.removeChat);
  const setTabStatus = useSessionStore((state) => state.setTabStatus);
  const setSessionTitle = useSessionStore((state) => state.setSessionTitle);
  const updateSessionPtyId = useSessionStore((state) => state.updateSessionPtyId);
  const activeSessionId = useSessionStore((state) => state.activeSessionId);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    let cleanedUp = false;
    setSessionTitle(tabId, "pi chat");

    const channel = new Channel<PiRpcEvent>();
    channel.onmessage = (event) => {
      appendEvent(tabId, event);
      if (event.type === "agent_start" || event.type === "message_update" || event.type === "tool_execution_start") {
        setTabStatus(tabId, "thinking");
      } else if (event.type === "agent_end" || event.type === "process_exit") {
        setTabStatus(tabId, null);
      }
    };

    createPiSession(projectPath, channel)
      .then((backendId) => {
        if (cleanedUp) {
          destroyPiSession(backendId).catch(() => {});
          return;
        }
        backendIdRef.current = backendId;
        updateSessionPtyId(tabId, backendId);
      })
      .catch((err) => {
        appendError(tabId, `Failed to start pi: ${String(err)}`);
        setTabStatus(tabId, null);
      });

    return () => {
      cleanedUp = true;
      const backendId = backendIdRef.current;
      backendIdRef.current = null;
      if (backendId) {
        destroyPiSession(backendId).catch(() => {});
      }
      removeChat(tabId);
      setTabStatus(tabId, null);
      initializedRef.current = false;
    };
  }, [appendError, appendEvent, projectPath, removeChat, setSessionTitle, setTabStatus, tabId, updateSessionPtyId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (activeSessionId === tabId && !isStreaming) {
      inputRef.current?.focus();
    }
  }, [activeSessionId, isStreaming, tabId]);

  const handleSend = useCallback(async () => {
    const text = inputValue.trim();
    const backendId = backendIdRef.current;
    if (!text || !backendId || isStreaming) return;

    setInputValue("");
    addUserMessage(tabId, text);
    setTabStatus(tabId, "thinking");

    try {
      await sendPiMessage(backendId, text);
    } catch (err) {
      appendError(tabId, String(err));
      setTabStatus(tabId, null);
    }
  }, [addUserMessage, appendError, inputValue, isStreaming, setTabStatus, tabId]);

  const handleInterrupt = useCallback(async () => {
    const backendId = backendIdRef.current;
    if (!backendId) return;
    try {
      await abortPiSession(backendId);
    } catch {
      setTabStatus(tabId, null);
    }
  }, [setTabStatus, tabId]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  return (
    <div className="pi-chat-view conversation-view">
      <div className="conversation-messages" ref={scrollRef}>
        {messages.length === 0 ? (
          <div className="conversation-empty">send a message to pi...</div>
        ) : (
          messages.map((message) => (
            message.role === "user" ? (
              <div className="conversation-user-message" key={message.id}>
                <span className="conversation-user-marker">&gt;</span>
                <span className="conversation-user-text">{getMessageText(message.blocks)}</span>
              </div>
            ) : (
              <div className="conversation-assistant-message" key={message.id}>
                {message.blocks.map((block, index) => (
                  <PiBlockView block={block} key={`${block.type}-${index}`} />
                ))}
              </div>
            )
          ))
        )}
        {isStreaming && (
          <div className="conversation-streaming-indicator">
            <span className="tui-blink">*</span> pi is working...
          </div>
        )}
      </div>

      <div className="conversation-input-wrapper">
        <div className="conversation-input-area">
          {isStreaming ? (
            <div className="conversation-input-streaming">
              <span className="conversation-streaming-text">
                <span className="tui-blink">*</span> running...
              </span>
              <button className="conversation-interrupt-btn" onClick={handleInterrupt}>
                :interrupt
              </button>
            </div>
          ) : (
            <div className="conversation-input-row">
              <span className="conversation-input-prefix">p&gt;</span>
              <textarea
                ref={inputRef}
                className="conversation-textarea"
                value={inputValue}
                onChange={(event) => setInputValue(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="message pi..."
                rows={1}
              />
              <button className="conversation-send-btn" onClick={handleSend} disabled={!inputValue.trim()}>
                :send
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PiBlockView({ block }: { block: PiChatBlock }) {
  if (block.type === "text") {
    return <pre className="pi-chat-text-block conversation-text-block">{block.content}</pre>;
  }

  if (block.type === "thinking") {
    return (
      <details className="conversation-collapsible pi-chat-details">
        <summary className="conversation-collapsible-header">
          <span className="conversation-collapsible-toggle">~</span>
          <span className="conversation-collapsible-label">thinking</span>
        </summary>
        <pre className="conversation-thinking-content">{block.content}</pre>
      </details>
    );
  }

  if (block.type === "tool") {
    return (
      <div className={`pi-chat-tool pi-chat-tool--${block.status}`}>
        <div className="pi-chat-tool-header">tool: {block.name} [{block.status}]</div>
        {block.args !== null && block.args !== undefined ? (
          <pre className="conversation-tool-input">{formatJson(block.args)}</pre>
        ) : null}
        {block.output ? (
          <pre className="conversation-tool-result-content">{block.output}</pre>
        ) : null}
      </div>
    );
  }

  return (
    <div className="conversation-error-block">
      <span className="conversation-error-prefix">error: </span>{block.content}
    </div>
  );
}

function getMessageText(blocks: PiChatBlock[]): string {
  const first = blocks[0];
  return first?.type === "text" ? first.content : "";
}

function formatJson(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
