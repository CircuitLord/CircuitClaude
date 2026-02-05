import { useState, useEffect, useRef, useMemo } from "react";
import { readConversation, getConversationMtime } from "../lib/conversation";
import { renderMarkdown } from "../lib/markdown";
import type { AssistantMessage } from "../lib/conversation";

interface CompanionPanelProps {
  projectPath: string;
  claudeSessionId?: string;
}

export function CompanionPanel({ projectPath, claudeSessionId }: CompanionPanelProps) {
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const lastMtimeRef = useRef<number | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(0);

  // Reset state when project/session changes
  useEffect(() => {
    setMessages([]);
    lastMtimeRef.current = null;
    prevCountRef.current = 0;
  }, [projectPath, claudeSessionId]);

  // Poll for mtime changes every 2s, fetch full conversation when mtime changes
  useEffect(() => {
    let cancelled = false;

    async function checkAndFetch() {
      if (cancelled) return;
      try {
        const mtime = await getConversationMtime(projectPath, claudeSessionId);
        if (cancelled) return;
        if (mtime !== null && mtime !== lastMtimeRef.current) {
          lastMtimeRef.current = mtime;
          const response = await readConversation(projectPath, claudeSessionId);
          if (cancelled) return;
          setMessages(response.messages);
        }
      } catch {
        // No conversation file yet — that's fine
      }
    }

    checkAndFetch();
    const interval = setInterval(checkAndFetch, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [projectPath, claudeSessionId]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (messages.length > prevCountRef.current && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
    prevCountRef.current = messages.length;
  }, [messages.length]);

  // Memoize rendered HTML per message uuid
  const renderedMessages = useMemo(() => {
    return messages.map((msg) => ({
      uuid: msg.uuid,
      html: renderMarkdown(msg.text),
    }));
  }, [messages]);

  return (
    <div className="companion-panel">
      <div className="companion-header">{">"} output</div>
      <div className="companion-body" ref={bodyRef}>
        {renderedMessages.length === 0 ? (
          <div className="companion-empty">waiting for response...</div>
        ) : (
          renderedMessages.map((msg) => (
            <div
              key={msg.uuid}
              className="companion-message"
              dangerouslySetInnerHTML={{ __html: msg.html }}
            />
          ))
        )}
      </div>
    </div>
  );
}
