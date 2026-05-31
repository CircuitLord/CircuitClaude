import { useCallback, useEffect, useRef, useState } from "react";
import { usePiSession } from "../hooks/usePiSession";
import { usePiChatStore } from "../stores/piChatStore";
import { useSessionStore } from "../stores/sessionStore";
import { PiChatMessageView } from "./PiChatBlocks";
import "./PiChatView.css";

interface PiChatViewProps {
  tabId: string;
  projectPath: string;
}

const EMPTY_MESSAGES = [] as const;

export function PiChatView({ tabId, projectPath }: PiChatViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [inputValue, setInputValue] = useState("");

  const messages = usePiChatStore(
    useCallback((state) => state.chats.get(tabId) ?? EMPTY_MESSAGES, [tabId]),
  );
  const isStreaming = usePiChatStore(
    useCallback((state) => state.streamingTabs.has(tabId), [tabId]),
  );
  const addUserMessage = usePiChatStore((state) => state.addUserMessage);
  const appendError = usePiChatStore((state) => state.appendError);
  const setTabStatus = useSessionStore((state) => state.setTabStatus);
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const { ready, sendMessage, interrupt } = usePiSession({ tabId, projectPath });

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, isStreaming]);

  useEffect(() => {
    if (activeSessionId === tabId && ready && !isStreaming) {
      inputRef.current?.focus();
    }
  }, [activeSessionId, isStreaming, ready, tabId]);

  const handleSend = useCallback(async () => {
    const text = inputValue.trim();
    if (!text || !ready || isStreaming) return;

    setInputValue("");
    addUserMessage(tabId, text);
    setTabStatus(tabId, "thinking");

    try {
      await sendMessage(text);
    } catch (err) {
      appendError(tabId, String(err));
      setTabStatus(tabId, null);
    }
  }, [addUserMessage, appendError, inputValue, isStreaming, ready, sendMessage, setTabStatus, tabId]);

  const handleInterrupt = useCallback(async () => {
    try {
      await interrupt();
    } catch (err) {
      appendError(tabId, String(err));
      setTabStatus(tabId, null);
    }
  }, [appendError, interrupt, setTabStatus, tabId]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  return (
    <div className="pi-chat-view">
      <div className="pi-chat-log" ref={scrollRef}>
        {messages.length === 0 ? (
          <div className="pi-chat-empty">p&gt; {ready ? "send a message to pi..." : "starting pi..."}</div>
        ) : (
          messages.map((message) => <PiChatMessageView message={message} key={message.id} />)
        )}
        {isStreaming && (
          <div className="pi-chat-working">
            <span className="tui-blink">*</span> pi is working...
          </div>
        )}
      </div>

      <div className="pi-chat-input-shell">
        {isStreaming ? (
          <div className="pi-chat-running-row">
            <span className="pi-chat-running-label">
              <span className="tui-blink">*</span> running...
            </span>
            <button className="pi-chat-command" onClick={handleInterrupt}>
              :interrupt
            </button>
          </div>
        ) : (
          <div className="pi-chat-input-row">
            <span className="pi-chat-input-prefix">p&gt;</span>
            <textarea
              ref={inputRef}
              className="pi-chat-input"
              value={inputValue}
              onChange={(event) => setInputValue(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={ready ? "message pi..." : "starting pi..."}
              rows={1}
              disabled={!ready}
            />
            <button className="pi-chat-command" onClick={handleSend} disabled={!ready || !inputValue.trim()}>
              :send
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
