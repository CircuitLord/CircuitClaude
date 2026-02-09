import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { Channel } from "@tauri-apps/api/core";
import { createClaudeSession, sendClaudeMessage, interruptClaudeSession, destroyClaudeSession, respondToPermission, respondToQuestion } from "../lib/claude";
import { useConversationStore, selectActivePrompt } from "../stores/conversationStore";
import type { ActivePrompt } from "../stores/conversationStore";
import { useSessionStore } from "../stores/sessionStore";
import { renderMarkdown } from "../lib/markdown";
import { useSlashAutocomplete } from "../hooks/useSlashAutocomplete";
import { SlashCommandMenu } from "./SlashCommandMenu";
import type { ClaudeEvent, ConversationMessage, ConversationBlock, SessionStats, UserQuestionItem, PermissionStatus } from "../types";

interface ConversationViewProps {
  tabId: string;
  projectPath: string;
}

const EMPTY_MESSAGES: ConversationMessage[] = [];

function getActivePromptKey(p: ActivePrompt | null): string | null {
  if (!p) return null;
  return p.kind === "permission" ? `p:${p.permissionId}` : `q:${p.questionId}`;
}

export function ConversationView({ tabId, projectPath }: ConversationViewProps) {
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
  const isPlanMode = useConversationStore(
    useCallback((s) => s.planModeTabs.has(tabId), [tabId])
  );
  const togglePlanMode = useConversationStore((s) => s.togglePlanMode);
  const clearPlanMode = useConversationStore((s) => s.clearPlanMode);
  const isAutoApprove = useConversationStore(
    useCallback((s) => s.autoApproveTabs.has(tabId), [tabId])
  );
  const setAutoApprove = useConversationStore((s) => s.setAutoApprove);
  const clearAutoApprove = useConversationStore((s) => s.clearAutoApprove);
  const setTabStatus = useSessionStore((s) => s.setTabStatus);

  // Register with backend on mount — channel lives for session lifetime
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    let cleanedUp = false;

    async function init() {
      // Create session-lifetime channel
      const channel = new Channel<ClaudeEvent>();
      channel.onmessage = (event: ClaudeEvent) => {
        appendToAssistant(tabId, event);
        if (event.type === "MessageStop") {
          setTabStatus(tabId, null);
        }
        // Auto-respond to permissions that were auto-approved by the store
        if (event.type === "PermissionRequest") {
          const state = useConversationStore.getState();
          // If the permission wasn't added to pendingPermissions, it was auto-approved
          if (!state.pendingPermissions.has(event.data.id) && backendIdRef.current) {
            respondToPermission(backendIdRef.current, event.data.id, true).catch((err) => {
              console.error("Failed to auto-respond to permission:", err);
            });
          }
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

  // Escape key exits auto-approve mode
  useEffect(() => {
    if (!isAutoApprove) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        clearAutoApprove(tabId);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isAutoApprove, tabId, clearAutoApprove]);

  const handleSend = useCallback(async () => {
    const text = inputValue.trim();
    if (!text || isStreaming || !backendIdRef.current) return;

    // Intercept /plan — toggle locally, don't send to backend
    if (text === "/plan") {
      setInputValue("");
      togglePlanMode(tabId);
      return;
    }

    setInputValue("");
    addUserMessage(tabId, text);
    clearAutoApprove(tabId);
    setTabStatus(tabId, "thinking");

    try {
      await sendClaudeMessage(backendIdRef.current, text, isPlanMode ? "plan" : undefined);
    } catch (err) {
      appendToAssistant(tabId, {
        type: "Error",
        data: { message: String(err) },
      });
      setTabStatus(tabId, null);
    }
  }, [inputValue, isStreaming, tabId, isPlanMode, addUserMessage, appendToAssistant, setTabStatus, togglePlanMode, clearAutoApprove]);

  const handleSendDirect = useCallback(async (text: string) => {
    if (!text.trim() || isStreaming || !backendIdRef.current) return;

    // Intercept /plan — toggle locally, don't send to backend
    if (text.trim() === "/plan") {
      togglePlanMode(tabId);
      return;
    }

    addUserMessage(tabId, text);
    clearAutoApprove(tabId);
    setTabStatus(tabId, "thinking");
    try {
      await sendClaudeMessage(backendIdRef.current, text, isPlanMode ? "plan" : undefined);
    } catch (err) {
      appendToAssistant(tabId, {
        type: "Error",
        data: { message: String(err) },
      });
      setTabStatus(tabId, null);
    }
  }, [isStreaming, tabId, isPlanMode, addUserMessage, appendToAssistant, setTabStatus, togglePlanMode, clearAutoApprove]);

  const autocomplete = useSlashAutocomplete({
    inputValue,
    setInputValue,
    sendDirect: handleSendDirect,
  });

  const handleInterrupt = useCallback(async () => {
    if (!backendIdRef.current) return;
    clearAutoApprove(tabId);
    try {
      await interruptClaudeSession(backendIdRef.current);
    } catch {
      // Already stopped
    }
  }, [tabId, clearAutoApprove]);

  const handlePermissionResponse = useCallback(async (permissionId: string, allowed: boolean) => {
    if (!backendIdRef.current) return;
    resolvePermission(tabId, permissionId, allowed ? "allowed" : "denied");

    // Auto-clear plan mode and enable auto-approve when ExitPlanMode is approved
    if (allowed && activePrompt?.kind === "permission" && activePrompt.tool === "ExitPlanMode") {
      clearPlanMode(tabId);
      setAutoApprove(tabId);
    }

    try {
      await respondToPermission(backendIdRef.current, permissionId, allowed);
    } catch (err) {
      console.error("Failed to respond to permission:", err);
    }
  }, [tabId, resolvePermission, activePrompt, clearPlanMode, setAutoApprove]);

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
    if (autocomplete.handleKey(e)) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [autocomplete, handleSend]);

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
        {autocomplete.isOpen && (
          <SlashCommandMenu
            matches={autocomplete.matches}
            selectedIndex={autocomplete.selectedIndex}
            onSelect={autocomplete.selectByIndex}
          />
        )}
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
                <span className="tui-blink">*</span> {isAutoApprove ? "executing plan..." : "responding..."}
              </span>
              <div className="conversation-streaming-actions">
                {isAutoApprove && (
                  <button
                    className="conversation-auto-exit-btn"
                    onClick={() => clearAutoApprove(tabId)}
                  >
                    :stop-auto
                  </button>
                )}
                <button
                  className="conversation-interrupt-btn"
                  onClick={handleInterrupt}
                >
                  :interrupt
                </button>
              </div>
            </div>
          ) : (
            <>
              {isPlanMode && (
                <div className="plan-mode-indicator">
                  <span className="plan-mode-indicator-icon">~</span>
                  <span className="plan-mode-indicator-label">plan mode</span>
                  <button
                    className="plan-mode-indicator-exit"
                    onClick={() => togglePlanMode(tabId)}
                  >
                    :exit
                  </button>
                </div>
              )}
              {isAutoApprove && (
                <div className="auto-approve-indicator">
                  <span className="auto-approve-indicator-icon">+</span>
                  <span className="auto-approve-indicator-label">auto-approve</span>
                  <button
                    className="auto-approve-indicator-exit"
                    onClick={() => clearAutoApprove(tabId)}
                  >
                    :exit
                  </button>
                </div>
              )}
              <div className="conversation-input-row">
                <span className={`conversation-input-prefix${isPlanMode ? " conversation-input-prefix--plan" : ""}`}>{isPlanMode ? "~" : ">"}</span>
                <textarea
                  ref={inputRef}
                  className="conversation-textarea"
                  value={inputValue}
                  onChange={(e) => { setInputValue(e.target.value); autocomplete.updateFromInput(e.target.value); }}
                  onKeyDown={handleKeyDown}
                  placeholder={isPlanMode ? "describe your plan..." : "message claude..."}
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
            </>
          )}
        </div>
        <InputStats stats={stats} isAutoApprove={isAutoApprove} />
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

function InputStats({ stats, isAutoApprove }: { stats: SessionStats | undefined; isAutoApprove?: boolean }) {
  if (!stats || !stats.model) {
    return (
      <div className="conversation-input-stats">
        <span className="conversation-input-stats-empty">awaiting first message...</span>
      </div>
    );
  }

  const totalTokens = stats.inputTokens + stats.outputTokens + stats.cacheReadTokens + stats.cacheCreationTokens;
  const isPlan = stats.permissionMode === "plan";

  return (
    <div className="conversation-input-stats">
      <span className="conversation-input-stats-model">{stats.model}</span>
      <span className="conversation-input-stats-sep">|</span>
      <span className={isAutoApprove ? "conversation-input-stats-auto" : isPlan ? "conversation-input-stats-plan" : "conversation-input-stats-value"}>
        {isAutoApprove ? "auto" : stats.permissionMode}
      </span>
      <span className="conversation-input-stats-sep">|</span>
      <span className="conversation-input-stats-value">
        {stats.toolCount} {stats.toolCount === 1 ? "tool" : "tools"}
      </span>
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
      if (block.permissionTool === "ExitPlanMode") {
        return (
          <PlanApprovalBlock
            input={block.toolInput}
            status={block.permissionStatus!}
          />
        );
      }
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
    case "ExitPlanMode":
      return "plan ready for execution";
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
    if (prompt.tool === "ExitPlanMode") {
      return (
        <PlanApprovalInput
          permissionId={prompt.permissionId}
          input={prompt.input}
          onResponse={onPermissionResponse}
        />
      );
    }
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
    const icon = status === "denied" ? "-" : "+";
    const label = status === "auto_approved" ? "auto" : status;
    return (
      <div className="conversation-permission conversation-permission--resolved">
        <span className="conversation-permission-icon">
          {icon}
        </span>
        <span className="conversation-permission-tool">{tool}</span>
        {summary && <span className="conversation-permission-summary"> {summary}</span>}
        <span className={`conversation-permission-status conversation-permission-status--${status}`}>
          {label}
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

// --- Plan Approval Input (renders in input area for ExitPlanMode) ---

interface AllowedPromptItem {
  tool: string;
  prompt: string;
}

function PlanApprovalInput({
  permissionId, input, onResponse,
}: {
  permissionId: string;
  input: unknown;
  onResponse: (id: string, allowed: boolean) => void;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const allowedPrompts = useMemo(() => {
    if (!input || typeof input !== "object") return [];
    const obj = input as Record<string, unknown>;
    if (Array.isArray(obj.allowedPrompts)) {
      return obj.allowedPrompts as AllowedPromptItem[];
    }
    return [];
  }, [input]);

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
      className="prompt-input plan-approval-input"
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <div className="prompt-input-header">
        <span className="plan-approval-icon">~</span>
        <span className="plan-approval-label">plan ready for execution</span>
      </div>
      {allowedPrompts.length > 0 && (
        <div className="plan-approval-prompts">
          {allowedPrompts.map((ap, i) => (
            <div key={i} className="plan-approval-prompt-item">
              <span className="plan-approval-prompt-tool">{ap.tool}</span>
              <span className="plan-approval-prompt-desc">{ap.prompt}</span>
            </div>
          ))}
        </div>
      )}
      <div className="prompt-input-options">
        <div className={`prompt-input-option prompt-input-option--allow ${selectedIndex === 0 ? "prompt-input-option--active" : ""}`}>
          <span className="prompt-input-option-marker">{selectedIndex === 0 ? ">" : " "}</span>
          <span>:approve</span>
        </div>
        <div className={`prompt-input-option prompt-input-option--deny ${selectedIndex === 1 ? "prompt-input-option--active" : ""}`}>
          <span className="prompt-input-option-marker">{selectedIndex === 1 ? ">" : " "}</span>
          <span>:deny</span>
        </div>
      </div>
    </div>
  );
}

// --- Plan Approval Block (inline display for ExitPlanMode) ---

function PlanApprovalBlock({ input, status }: { input: unknown; status: PermissionStatus }) {
  const allowedPrompts = useMemo(() => {
    if (!input || typeof input !== "object") return [];
    const obj = input as Record<string, unknown>;
    if (Array.isArray(obj.allowedPrompts)) {
      return obj.allowedPrompts as AllowedPromptItem[];
    }
    return [];
  }, [input]);

  if (status !== "pending") {
    const isApproved = status === "allowed" || status === "auto_approved";
    return (
      <div className="conversation-permission conversation-permission--resolved plan-approval-block--resolved">
        <span className="conversation-permission-icon">
          {isApproved ? "+" : "-"}
        </span>
        <span className="plan-approval-resolved-text">
          {isApproved ? "plan approved" : "plan denied"}
        </span>
      </div>
    );
  }

  return (
    <div className="plan-approval-block plan-approval-block--pending">
      <div className="plan-approval-block-header">
        <span className="plan-approval-icon">~</span>
        <span className="plan-approval-label">plan ready</span>
      </div>
      {allowedPrompts.length > 0 && (
        <div className="plan-approval-prompts">
          {allowedPrompts.map((ap, i) => (
            <div key={i} className="plan-approval-prompt-item">
              <span className="plan-approval-prompt-tool">{ap.tool}</span>
              <span className="plan-approval-prompt-desc">{ap.prompt}</span>
            </div>
          ))}
        </div>
      )}
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
