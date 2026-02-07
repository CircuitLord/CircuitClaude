import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { Channel } from "@tauri-apps/api/core";
import { createClaudeSession, sendClaudeMessage, interruptClaudeSession, destroyClaudeSession, respondToPermission, respondToQuestion } from "../lib/claude";
import { readConversation } from "../lib/conversation";
import { useConversationStore, selectActivePrompt } from "../stores/conversationStore";
import type { ActivePrompt } from "../stores/conversationStore";
import { useSessionStore } from "../stores/sessionStore";
import { renderMarkdown } from "../lib/markdown";
import type { ClaudeEvent, ConversationMessage, ConversationBlock, SessionStats, UserQuestionItem, PermissionStatus } from "../types";

interface ConversationViewProps {
  tabId: string;
  projectPath: string;
  claudeSessionId?: string;
  isRestored?: boolean;
  onClose: () => void;
}

const EMPTY_MESSAGES: ConversationMessage[] = [];

function getActivePromptKey(p: ActivePrompt | null): string | null {
  if (!p) return null;
  return p.kind === "permission" ? `p:${p.permissionId}` : `q:${p.questionId}`;
}

export function ConversationView({ tabId, projectPath, claudeSessionId, isRestored, onClose }: ConversationViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const backendIdRef = useRef<string | null>(null);
  const initializedRef = useRef(false);
  const [inputValue, setInputValue] = useState("");

  const messages = useConversationStore(
    useCallback((s) => s.conversations.get(tabId) ?? EMPTY_MESSAGES, [tabId])
  );
  const isStreaming = useConversationStore(
    useCallback((s) => s.streamingTabs.has(tabId), [tabId])
  );
  const stats: SessionStats | undefined = useConversationStore(
    useCallback((s) => s.sessionStats.get(tabId), [tabId])
  );
  const addUserMessage = useConversationStore((s) => s.addUserMessage);
  const appendToAssistant = useConversationStore((s) => s.appendToAssistant);
  const loadHistory = useConversationStore((s) => s.loadHistory);
  const removeConversation = useConversationStore((s) => s.removeConversation);
  // Subscribe to a stable string key to avoid infinite re-render from new object refs
  const activePromptKey = useConversationStore(
    useCallback((s) => getActivePromptKey(selectActivePrompt(s, tabId)), [tabId])
  );
  // Derive the full prompt object only when the key changes
  const activePrompt = useMemo(
    () => (activePromptKey ? selectActivePrompt(useConversationStore.getState(), tabId) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activePromptKey, tabId]
  );
  const resolvePermission = useConversationStore((s) => s.resolvePermission);
  const resolveQuestion = useConversationStore((s) => s.resolveQuestion);
  const markInteracted = useSessionStore((s) => s.markInteracted);
  const setStreaming = useSessionStore((s) => s.setStreaming);

  // Register with backend on mount — channel lives for session lifetime
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    let cleanedUp = false;

    async function init() {
      // Load history for restored sessions
      if (isRestored && claudeSessionId) {
        try {
          const response = await readConversation(projectPath, claudeSessionId);
          if (!cleanedUp && response.messages.length > 0) {
            const converted: ConversationMessage[] = response.messages.map((msg) => ({
              id: msg.uuid,
              role: msg.role === "human" ? "user" : "assistant",
              blocks: [{ type: "text" as const, content: msg.text }],
              timestamp: msg.timestamp ? new Date(msg.timestamp).getTime() : Date.now(),
            }));
            loadHistory(tabId, converted);
          }
        } catch {
          // No history — that's fine
        }
      }

      // Create session-lifetime channel
      const channel = new Channel<ClaudeEvent>();
      channel.onmessage = (event: ClaudeEvent) => {
        appendToAssistant(tabId, event);
        if (event.type === "MessageStop") {
          setStreaming(tabId, false);
        }
      };

      // Register with Claude manager (spawns bridge process)
      try {
        const backendId = await createClaudeSession(projectPath, channel);
        if (!cleanedUp) {
          backendIdRef.current = backendId;
        } else {
          destroyClaudeSession(backendId).catch(() => {});
        }
      } catch (err) {
        console.error("Failed to create Claude session:", err);
        if (isRestored) {
          onClose();
        }
      }
    }

    init();

    return () => {
      cleanedUp = true;
      if (backendIdRef.current) {
        destroyClaudeSession(backendIdRef.current).catch(() => {});
        backendIdRef.current = null;
      }
      removeConversation(tabId);
      initializedRef.current = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId, projectPath]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Focus input when tab becomes active
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  useEffect(() => {
    if (activeSessionId === tabId && !isStreaming) {
      inputRef.current?.focus();
    }
  }, [activeSessionId, tabId, isStreaming]);

  const handleSend = useCallback(async () => {
    const text = inputValue.trim();
    if (!text || isStreaming || !backendIdRef.current) return;

    setInputValue("");
    addUserMessage(tabId, text);
    markInteracted(tabId);
    setStreaming(tabId, true);

    try {
      await sendClaudeMessage(backendIdRef.current, text);
    } catch (err) {
      appendToAssistant(tabId, {
        type: "Error",
        data: { message: String(err) },
      });
      setStreaming(tabId, false);
    }
  }, [inputValue, isStreaming, tabId, addUserMessage, appendToAssistant, markInteracted, setStreaming]);

  const handleInterrupt = useCallback(async () => {
    if (!backendIdRef.current) return;
    try {
      await interruptClaudeSession(backendIdRef.current);
    } catch {
      // Already stopped
    }
  }, []);

  const handlePermissionResponse = useCallback(async (permissionId: string, allowed: boolean) => {
    if (!backendIdRef.current) return;
    resolvePermission(tabId, permissionId, allowed ? "allowed" : "denied");
    try {
      await respondToPermission(backendIdRef.current, permissionId, allowed);
    } catch (err) {
      console.error("Failed to respond to permission:", err);
    }
  }, [tabId, resolvePermission]);

  const handleQuestionResponse = useCallback(async (questionId: string, answers: Record<string, string>) => {
    if (!backendIdRef.current) return;
    resolveQuestion(tabId, questionId, answers);
    try {
      await respondToQuestion(backendIdRef.current, questionId, answers);
    } catch (err) {
      console.error("Failed to respond to question:", err);
    }
  }, [tabId, resolveQuestion]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  return (
    <div className="conversation-view">
      <div className="conversation-messages" ref={scrollRef}>
        {messages.length === 0 && !isStreaming ? (
          <div className="conversation-empty">send a message to start...</div>
        ) : (
          messages.map((msg) => (
            <MessageBlock key={msg.id} message={msg} />
          ))
        )}
        {isStreaming && messages.length > 0 && messages[messages.length - 1]?.blocks.length === 0 && (
          <div className="conversation-streaming-indicator">
            <span className="tui-blink">*</span> responding...
          </div>
        )}
      </div>
      <div className="conversation-input-wrapper">
        <div className="conversation-input-area">
          {activePrompt ? (
            <PromptInput
              key={activePrompt.kind === "permission" ? activePrompt.permissionId : activePrompt.questionId}
              prompt={activePrompt}
              onPermissionResponse={handlePermissionResponse}
              onQuestionResponse={handleQuestionResponse}
            />
          ) : isStreaming ? (
            <div className="conversation-input-streaming">
              <span className="conversation-streaming-text">
                <span className="tui-blink">*</span> responding...
              </span>
              <button
                className="conversation-interrupt-btn"
                onClick={handleInterrupt}
              >
                :interrupt
              </button>
            </div>
          ) : (
            <div className="conversation-input-row">
              <span className="conversation-input-prefix">{">"}</span>
              <textarea
                ref={inputRef}
                className="conversation-textarea"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="message claude..."
                rows={1}
                autoFocus
              />
              <button
                className="conversation-send-btn"
                onClick={handleSend}
                disabled={!inputValue.trim()}
              >
                :send
              </button>
            </div>
          )}
        </div>
        <InputStats stats={stats} />
      </div>
    </div>
  );
}

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "m";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return String(n);
}

function formatDuration(ms: number): string {
  const secs = Math.round(ms / 1000);
  if (secs < 60) return secs + "s";
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return mins + "m" + (rem > 0 ? rem + "s" : "");
}

function InputStats({ stats }: { stats: SessionStats | undefined }) {
  if (!stats || !stats.model) {
    return (
      <div className="conversation-input-stats">
        <span className="conversation-input-stats-empty">awaiting first message...</span>
      </div>
    );
  }

  const totalTokens = stats.inputTokens + stats.outputTokens + stats.cacheReadTokens + stats.cacheCreationTokens;

  return (
    <div className="conversation-input-stats">
      <span className="conversation-input-stats-model">{stats.model}</span>
      <span className="conversation-input-stats-sep">|</span>
      <span className="conversation-input-stats-value">
        {formatTokenCount(totalTokens)}
        {stats.contextWindow > 0 && <> / {formatTokenCount(stats.contextWindow)}</>}
        {" tokens"}
      </span>
      <span className="conversation-input-stats-sep">|</span>
      <span className="conversation-input-stats-value">
        {stats.turns} {stats.turns === 1 ? "turn" : "turns"}
      </span>
      <span className="conversation-input-stats-sep">|</span>
      <span className="conversation-input-stats-value">{formatDuration(stats.durationMs)}</span>
    </div>
  );
}

function MessageBlock({ message }: { message: ConversationMessage }) {
  if (message.role === "user") {
    return (
      <div className="conversation-user-message">
        <span className="conversation-user-marker">{">"}</span>
        <span className="conversation-user-text">{message.blocks[0]?.content}</span>
      </div>
    );
  }

  return (
    <div className="conversation-assistant-message">
      {message.blocks.map((block, i) => (
        <BlockRenderer key={i} block={block} />
      ))}
    </div>
  );
}

interface BlockRendererProps {
  block: ConversationBlock;
}

function BlockRenderer({ block }: BlockRendererProps) {
  switch (block.type) {
    case "text":
      return <TextBlock content={block.content} />;
    case "thinking":
      return <ThinkingBlock content={block.content} />;
    case "tool_use":
      return <ToolUseBlock name={block.toolName ?? "tool"} input={block.toolInput} />;
    case "tool_result":
      return <ToolResultBlock content={block.content} isError={block.isError} />;
    case "error":
      return <ErrorBlock message={block.content} />;
    case "permission_request":
      return (
        <PermissionPrompt
          tool={block.permissionTool!}
          input={block.toolInput}
          description={block.permissionDescription!}
          status={block.permissionStatus!}
        />
      );
    case "user_question":
      return (
        <UserQuestionPrompt
          questions={block.questions!}
          status={block.questionStatus!}
          answers={block.answers}
        />
      );
    default:
      return null;
  }
}

function TextBlock({ content }: { content: string }) {
  const html = useMemo(() => renderMarkdown(content), [content]);
  return (
    <div
      className="conversation-text-block companion-message"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function ThinkingBlock({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="conversation-collapsible">
      <button
        className="conversation-collapsible-header"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="conversation-collapsible-toggle">{expanded ? "[-]" : "[+]"}</span>
        <span className="conversation-collapsible-label">thinking...</span>
      </button>
      {expanded && (
        <div className="conversation-thinking-content">
          {content}
        </div>
      )}
    </div>
  );
}

function getToolSummary(name: string, input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const obj = input as Record<string, unknown>;

  switch (name) {
    case "Read":
    case "Write":
      if (typeof obj.file_path === "string") {
        const parts = obj.file_path.replace(/\\/g, "/").split("/");
        return parts.slice(-2).join("/");
      }
      return "";
    case "Edit":
      if (typeof obj.file_path === "string") {
        const parts = obj.file_path.replace(/\\/g, "/").split("/");
        return parts.slice(-2).join("/");
      }
      return "";
    case "Glob":
      return typeof obj.pattern === "string" ? obj.pattern : "";
    case "Grep":
      return typeof obj.pattern === "string" ? obj.pattern : "";
    case "Bash": {
      const cmd = typeof obj.command === "string" ? obj.command : "";
      return cmd.length > 60 ? cmd.slice(0, 57) + "..." : cmd;
    }
    case "Task":
      return typeof obj.description === "string" ? obj.description : "";
    case "WebFetch":
      if (typeof obj.url === "string") {
        try {
          return new URL(obj.url).hostname;
        } catch {
          return obj.url.slice(0, 40);
        }
      }
      return "";
    case "WebSearch":
      return typeof obj.query === "string" ? obj.query : "";
    default:
      return "";
  }
}

function ToolUseBlock({ name, input }: { name: string; input?: unknown }) {
  const [expanded, setExpanded] = useState(false);
  const inputStr = useMemo(() => {
    if (!input || input === null) return "";
    try {
      return JSON.stringify(input, null, 2);
    } catch {
      return String(input);
    }
  }, [input]);
  const summary = useMemo(() => getToolSummary(name, input), [name, input]);

  return (
    <div className="conversation-collapsible">
      <button
        className="conversation-collapsible-header"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="conversation-collapsible-toggle">{expanded ? "[-]" : "[+]"}</span>
        <span className="conversation-collapsible-label">
          tool: {name}{summary ? <span className="conversation-tool-summary"> {summary}</span> : null}
        </span>
      </button>
      {expanded && inputStr && (
        <pre className="conversation-tool-input">{inputStr}</pre>
      )}
    </div>
  );
}

function ToolResultBlock({ content, isError }: { content: string; isError?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = content.length > 200;

  if (!isLong) {
    return (
      <div className={`conversation-tool-result ${isError ? "conversation-tool-result--error" : ""}`}>
        <pre className="conversation-tool-result-content">{content}</pre>
      </div>
    );
  }

  return (
    <div className={`conversation-tool-result ${isError ? "conversation-tool-result--error" : ""}`}>
      <button
        className="conversation-collapsible-header"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="conversation-collapsible-toggle">{expanded ? "[-]" : "[+]"}</span>
        <span className="conversation-collapsible-label">
          {isError ? "error result" : "result"} ({content.length} chars)
        </span>
      </button>
      {expanded && (
        <pre className="conversation-tool-result-content">{content}</pre>
      )}
    </div>
  );
}

function ErrorBlock({ message }: { message: string }) {
  return (
    <div className="conversation-error-block">
      <span className="conversation-error-prefix">error:</span> {message}
    </div>
  );
}

// --- Prompt Input (renders in input area) ---

interface PromptInputProps {
  prompt: ActivePrompt;
  onPermissionResponse: (id: string, allowed: boolean) => void;
  onQuestionResponse: (id: string, answers: Record<string, string>) => void;
}

function PromptInput({ prompt, onPermissionResponse, onQuestionResponse }: PromptInputProps) {
  if (prompt.kind === "permission") {
    return (
      <PermissionInput
        permissionId={prompt.permissionId}
        tool={prompt.tool}
        input={prompt.input}
        description={prompt.description}
        onResponse={onPermissionResponse}
      />
    );
  }
  return (
    <QuestionInput
      questionId={prompt.questionId}
      questions={prompt.questions}
      onResponse={onQuestionResponse}
    />
  );
}

function PermissionInput({
  permissionId, tool, input, description, onResponse,
}: {
  permissionId: string;
  tool: string;
  input: unknown;
  description: string;
  onResponse: (id: string, allowed: boolean) => void;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const summary = useMemo(() => getToolSummary(tool, input) || description, [tool, input, description]);

  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev === 0 ? 1 : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      onResponse(permissionId, selectedIndex === 0);
    }
  }, [permissionId, selectedIndex, onResponse]);

  return (
    <div
      className="prompt-input"
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <div className="prompt-input-header">
        <span className="prompt-input-icon tui-blink">*</span>
        <span className="prompt-input-tool">{tool}</span>
        {summary && <span className="prompt-input-summary">{summary}</span>}
      </div>
      <div className="prompt-input-options">
        <div className={`prompt-input-option prompt-input-option--allow ${selectedIndex === 0 ? "prompt-input-option--active" : ""}`}>
          <span className="prompt-input-option-marker">{selectedIndex === 0 ? ">" : " "}</span>
          <span>:allow</span>
        </div>
        <div className={`prompt-input-option prompt-input-option--deny ${selectedIndex === 1 ? "prompt-input-option--active" : ""}`}>
          <span className="prompt-input-option-marker">{selectedIndex === 1 ? ">" : " "}</span>
          <span>:deny</span>
        </div>
      </div>
    </div>
  );
}

function QuestionInput({
  questionId, questions, onResponse,
}: {
  questionId: string;
  questions: UserQuestionItem[];
  onResponse: (id: string, answers: Record<string, string>) => void;
}) {
  const [currentItem, setCurrentItem] = useState(0);
  const [selectedOptionIndex, setSelectedOptionIndex] = useState(0);
  const [freeTextValue, setFreeTextValue] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const q = questions[currentItem];
  const hasOptions = q?.options && q.options.length > 0;
  const totalItems = questions.length;

  // Focus container (for option mode) or textarea (for free text) on mount / item change
  useEffect(() => {
    if (hasOptions) {
      containerRef.current?.focus();
    } else {
      textareaRef.current?.focus();
    }
  }, [currentItem, hasOptions]);

  const advanceOrSubmit = useCallback((answer: string) => {
    const key = q?.header || String(currentItem);
    const nextAnswers = { ...answers, [key]: answer };
    setAnswers(nextAnswers);

    if (currentItem < totalItems - 1) {
      setCurrentItem((prev) => prev + 1);
      setSelectedOptionIndex(0);
      setFreeTextValue("");
    } else {
      onResponse(questionId, nextAnswers);
    }
  }, [answers, currentItem, totalItems, questionId, onResponse]);

  const handleOptionKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!hasOptions || !q.options) return;
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedOptionIndex((prev) => (prev <= 0 ? q.options!.length - 1 : prev - 1));
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedOptionIndex((prev) => (prev >= q.options!.length - 1 ? 0 : prev + 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      advanceOrSubmit(q.options[selectedOptionIndex].label);
    }
  }, [hasOptions, q, selectedOptionIndex, advanceOrSubmit]);

  const handleFreeTextKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      advanceOrSubmit(freeTextValue);
    }
  }, [freeTextValue, advanceOrSubmit]);

  if (!q) return null;

  return (
    <div
      className="prompt-input"
      ref={containerRef}
      tabIndex={hasOptions ? 0 : -1}
      onKeyDown={hasOptions ? handleOptionKeyDown : undefined}
    >
      <div className="prompt-input-header">
        <span className="prompt-input-icon">?</span>
        {totalItems > 1 && <span className="prompt-input-step">[{currentItem + 1}/{totalItems}]</span>}
        <span className="prompt-input-question">{q.question}</span>
      </div>
      {hasOptions ? (
        <div className="prompt-input-options">
          {q.options!.map((opt, oi) => (
            <div
              key={oi}
              className={`prompt-input-option ${selectedOptionIndex === oi ? "prompt-input-option--active" : ""}`}
            >
              <span className="prompt-input-option-marker">{selectedOptionIndex === oi ? ">" : " "}</span>
              <span>{opt.label}</span>
              {opt.description && <span className="prompt-input-option-desc"> — {opt.description}</span>}
            </div>
          ))}
        </div>
      ) : (
        <div className="conversation-input-row">
          <span className="conversation-input-prefix">{">"}</span>
          <textarea
            ref={textareaRef}
            className="conversation-textarea"
            value={freeTextValue}
            onChange={(e) => setFreeTextValue(e.target.value)}
            onKeyDown={handleFreeTextKeyDown}
            placeholder="type your answer..."
            rows={1}
            autoFocus
          />
        </div>
      )}
    </div>
  );
}

// --- Permission Prompt (inline display) ---

interface PermissionPromptProps {
  tool: string;
  input: unknown;
  description: string;
  status: PermissionStatus;
}

function PermissionPrompt({ tool, input, description, status }: PermissionPromptProps) {
  const summary = useMemo(() => getToolSummary(tool, input) || description, [tool, input, description]);

  if (status !== "pending") {
    return (
      <div className="conversation-permission conversation-permission--resolved">
        <span className="conversation-permission-icon">
          {status === "allowed" ? "+" : "-"}
        </span>
        <span className="conversation-permission-tool">{tool}</span>
        {summary && <span className="conversation-permission-summary"> {summary}</span>}
        <span className={`conversation-permission-status conversation-permission-status--${status}`}>
          {status}
        </span>
      </div>
    );
  }

  return (
    <div className="conversation-permission conversation-permission--pending">
      <div className="conversation-permission-header">
        <span className="conversation-permission-icon tui-blink">*</span>
        <span className="conversation-permission-tool">{tool}</span>
        {summary && <span className="conversation-permission-summary"> {summary}</span>}
      </div>
      <span className="conversation-permission-pending-hint">respond below...</span>
    </div>
  );
}

// --- User Question Prompt ---

interface UserQuestionPromptProps {
  questions: UserQuestionItem[];
  status: "pending" | "answered";
  answers?: Record<string, string>;
}

function UserQuestionPrompt({ questions, status, answers: resolvedAnswers }: UserQuestionPromptProps) {
  if (status === "answered" && resolvedAnswers) {
    return (
      <div className="conversation-question conversation-question--resolved">
        <span className="conversation-question-icon">?</span>
        <div className="conversation-question-answered">
          {questions.map((q, i) => (
            <div key={i} className="conversation-question-answer-row">
              <span className="conversation-question-label">{q.header || q.question}</span>
              <span className="conversation-question-answer-value">
                {resolvedAnswers[q.header || String(i)] || "—"}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="conversation-question conversation-question--pending">
      {questions.map((q, qi) => (
        <div key={qi} className="conversation-question-item">
          <div className="conversation-question-header">
            <span className="conversation-question-icon">?</span>
            <span className="conversation-question-text">{q.question}</span>
          </div>
        </div>
      ))}
      <span className="conversation-question-pending-hint">respond below...</span>
    </div>
  );
}
