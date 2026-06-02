import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import { usePiSession } from "../hooks/usePiSession";
import { listPiSessions, savePiChatSettings, type PiSessionInfo } from "../lib/pi";
import { THEMES } from "../lib/themes";
import { usePiChatStore } from "../stores/piChatStore";
import { useProjectStore } from "../stores/projectStore";
import { useSessionStore } from "../stores/sessionStore";
import { useSettingsStore } from "../stores/settingsStore";
import type { PiModel, PiPermissionMode, PiThinkingLevel } from "../lib/piRpc";
import { getSupportedThinkingLevels } from "../lib/piRpc";
import { PiChatMessageView } from "./PiChatBlocks";
import "./PiChatView.css";

interface PiChatViewProps {
  tabId: string;
  projectPath: string;
}

interface AvailableModelsResponse {
  models?: PiModel[];
}

interface PiStateResponse {
  model?: PiModel | null;
  thinkingLevel?: PiThinkingLevel;
  sessionName?: string;
}

interface PiMessagesResponse {
  messages?: unknown[];
}

interface PiSwitchSessionResponse {
  cancelled?: boolean;
}

const EMPTY_MESSAGES = [] as const;

interface PiChatSelectOption<T extends string> {
  label: string;
  value: T;
}

function modelKey(model: PiModel): string {
  return `${model.provider}\u0000${model.id}`;
}

function modelLabel(model: PiModel): string {
  return model.id;
}

function getDuplicateModelIds(models: PiModel[]): Set<string> {
  const counts = new Map<string, number>();
  for (const model of models) {
    const key = model.id.trim().toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([id]) => id));
}

function modelOptionLabel(model: PiModel, duplicateModelIds: Set<string>): string {
  return duplicateModelIds.has(model.id.trim().toLowerCase())
    ? `${modelLabel(model)} [${model.provider}]`
    : modelLabel(model);
}

function isPreferredModel(model: PiModel): boolean {
  return /5\.[45]/.test(model.id) || /5\.[45]/.test(model.name ?? "");
}

function modeCommand(mode: PiPermissionMode): string {
  return `/permissions mode ${mode}`;
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest("button, textarea, input, select, summary, a, [role='button'], [contenteditable='true'], [contenteditable=''], [contenteditable='plaintext-only']"));
}

function isSelectableChatTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(".pi-chat-message, .pi-chat-empty, .pi-chat-working"));
}

function sessionDisplayName(session: PiSessionInfo): string {
  return session.name || session.firstMessage || session.id;
}

function formatSessionAge(timestamp: number): string {
  if (!timestamp) return "old";
  const ageMs = Date.now() - timestamp;
  const minutes = Math.max(0, Math.floor(ageMs / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function PiChatSelect<T extends string>({
  ariaLabel,
  className,
  disabled,
  options,
  value,
  onChange,
  triggerPrefix,
}: {
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  options: Array<PiChatSelectOption<T>>;
  value: T;
  onChange: (value: T) => void;
  triggerPrefix?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selectedLabel = options.find((option) => option.value === value)?.label ?? value;

  useEffect(() => {
    if (!open) return;

    function handleClick(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClick);
    window.addEventListener("keydown", handleKey, true);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      window.removeEventListener("keydown", handleKey, true);
    };
  }, [open]);

  return (
    <div className={`pi-chat-select${className ? ` ${className}` : ""}`} ref={ref}>
      <button
        type="button"
        className="pi-chat-select-trigger"
        onClick={() => !disabled && setOpen((current) => !current)}
        disabled={disabled}
        aria-label={ariaLabel}
      >
        <span className="pi-chat-select-chevron">{">"}</span>
        {triggerPrefix && <span className="pi-chat-select-prefix">{triggerPrefix}</span>}
        <span className="pi-chat-select-label">{selectedLabel}</span>
      </button>
      {open && !disabled && (
        <div className="pi-chat-select-dropdown">
          {options.map((option) => (
            <button
              type="button"
              key={option.value}
              className={`pi-chat-select-option${option.value === value ? " pi-chat-select-option--active" : ""}`}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              <span className="pi-chat-select-option-marker">
                {option.value === value ? "*" : " "}
              </span>
              <span className="pi-chat-select-option-content">{option.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function PiChatView({ tabId, projectPath }: PiChatViewProps) {
  const viewRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const loadMenuRef = useRef<HTMLDivElement>(null);
  const keyboardCaptureRef = useRef(false);
  const pendingInputSelectionRef = useRef<{ start: number; end: number } | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [permissionMode, setPermissionMode] = useState<PiPermissionMode>("default");
  const [availableModels, setAvailableModels] = useState<PiModel[]>([]);
  const [currentModel, setCurrentModel] = useState<PiModel | null>(null);
  const [thinkingLevel, setThinkingLevel] = useState<PiThinkingLevel>("off");
  const [loadMenuOpen, setLoadMenuOpen] = useState(false);
  const [loadSessions, setLoadSessions] = useState<PiSessionInfo[]>([]);
  const [loadSessionsLoading, setLoadSessionsLoading] = useState(false);
  const [loadSessionsError, setLoadSessionsError] = useState<string | null>(null);
  const [, setToolbarError] = useState<string | null>(null);

  const messages = usePiChatStore(
    useCallback((state) => state.chats.get(tabId) ?? EMPTY_MESSAGES, [tabId]),
  );
  const isStreaming = usePiChatStore(
    useCallback((state) => state.streamingTabs.has(tabId), [tabId]),
  );
  const syncedPermissionMode = usePiChatStore(
    useCallback((state) => state.permissionModes.get(tabId) ?? "default", [tabId]),
  );
  const setMessagesFromPi = usePiChatStore((state) => state.setMessagesFromPi);
  const addUserMessage = usePiChatStore((state) => state.addUserMessage);
  const appendError = usePiChatStore((state) => state.appendError);
  const setTabStatus = useSessionStore((state) => state.setTabStatus);
  const setSessionTitle = useSessionStore((state) => state.setSessionTitle);
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const piChatFontFamily = useSettingsStore((state) => state.settings.piChatFontFamily);
  const piChatFontSize = useSettingsStore((state) => state.settings.piChatFontSize);
  const projectTheme = useProjectStore((state) => state.projects.find((project) => project.path === projectPath)?.theme ?? "midnight");
  const { ready, backendId, sendMessage, sendCommand, interrupt } = usePiSession({ tabId, projectPath });

  const preferredModels = availableModels.filter(isPreferredModel);
  const modelOptions = currentModel && !preferredModels.some((model) => modelKey(model) === modelKey(currentModel))
    ? [currentModel, ...preferredModels]
    : preferredModels;
  const duplicateModelIds = getDuplicateModelIds(modelOptions);
  const currentModelKey = currentModel ? modelKey(currentModel) : "";
  const effortLevels = getSupportedThinkingLevels(currentModel);
  const effortValue = effortLevels.includes(thinkingLevel) ? thinkingLevel : (effortLevels[0] ?? "off");
  const chatTheme = THEMES[projectTheme] ?? THEMES.midnight;
  const chatStyle = {
    "--pi-chat-project-highlight": chatTheme.css["--accent-text"],
    "--pi-chat-font-family": piChatFontFamily,
    "--pi-chat-font-size": `${piChatFontSize}px`,
  } as CSSProperties;

  useEffect(() => {
    setPermissionMode(syncedPermissionMode);
  }, [syncedPermissionMode]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, isStreaming]);

  useEffect(() => {
    if (activeSessionId === tabId && ready) {
      keyboardCaptureRef.current = true;
      inputRef.current?.focus();
    }
  }, [activeSessionId, ready, tabId]);

  useLayoutEffect(() => {
    const selection = pendingInputSelectionRef.current;
    if (!selection || !ready) return;

    pendingInputSelectionRef.current = null;
    const input = inputRef.current;
    if (!input) return;

    input.focus({ preventScroll: true });
    input.setSelectionRange(selection.start, selection.end);
  }, [inputValue, ready]);

  useEffect(() => {
    if (!ready) {
      setAvailableModels([]);
      setCurrentModel(null);
      setThinkingLevel("off");
      return;
    }

    let cancelled = false;

    async function loadModels() {
      try {
        const [modelsResponse, stateResponse] = await Promise.all([
          sendCommand<AvailableModelsResponse>({ type: "get_available_models" }),
          sendCommand<PiStateResponse>({ type: "get_state" }),
        ]);
        if (cancelled) return;

        const models = Array.isArray(modelsResponse.models) ? modelsResponse.models : [];
        setAvailableModels(models);
        setCurrentModel(stateResponse.model ?? models[0] ?? null);
        if (stateResponse.thinkingLevel) setThinkingLevel(stateResponse.thinkingLevel);
        setToolbarError(null);
      } catch (err) {
        if (cancelled) return;
        setToolbarError(String(err));
      }
    }

    void loadModels();

    return () => {
      cancelled = true;
    };
  }, [ready, sendCommand]);

  useEffect(() => {
    if (!loadMenuOpen) return;

    function handleClick(event: MouseEvent) {
      if (loadMenuRef.current && !loadMenuRef.current.contains(event.target as Node)) {
        setLoadMenuOpen(false);
      }
    }

    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        setLoadMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClick);
    window.addEventListener("keydown", handleKey, true);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      window.removeEventListener("keydown", handleKey, true);
    };
  }, [loadMenuOpen]);

  const loadCurrentMessages = useCallback(async () => {
    const response = await sendCommand<PiMessagesResponse>({ type: "get_messages" });
    setMessagesFromPi(tabId, Array.isArray(response.messages) ? response.messages : []);
  }, [sendCommand, setMessagesFromPi, tabId]);

  const refreshLoadSessions = useCallback(async () => {
    setLoadSessionsLoading(true);
    setLoadSessionsError(null);
    try {
      setLoadSessions(await listPiSessions(projectPath));
    } catch (err) {
      setLoadSessions([]);
      setLoadSessionsError(String(err));
    } finally {
      setLoadSessionsLoading(false);
    }
  }, [projectPath]);

  const handleLoadMenuToggle = useCallback(() => {
    if (!ready || isStreaming) return;
    setLoadMenuOpen((current) => {
      const next = !current;
      if (next) void refreshLoadSessions();
      return next;
    });
  }, [isStreaming, ready, refreshLoadSessions]);

  const handleLoadSession = useCallback(async (session: PiSessionInfo) => {
    if (!ready || isStreaming) return;
    setLoadMenuOpen(false);
    setTabStatus(tabId, "thinking");

    try {
      const result = await sendCommand<PiSwitchSessionResponse>({ type: "switch_session", sessionPath: session.path });
      if (result.cancelled) return;
      await loadCurrentMessages();
      const state = await sendCommand<PiStateResponse>({ type: "get_state" });
      if (state.model) setCurrentModel(state.model);
      if (state.thinkingLevel) setThinkingLevel(state.thinkingLevel);
      setSessionTitle(tabId, `pi: ${sessionDisplayName(session)}`);
      setToolbarError(null);
    } catch (err) {
      appendError(tabId, String(err));
    } finally {
      setTabStatus(tabId, null);
    }
  }, [appendError, isStreaming, loadCurrentMessages, ready, sendCommand, setSessionTitle, setTabStatus, tabId]);

  const handleSend = useCallback(async () => {
    const text = inputValue.trim();
    if (!text || !ready) return;

    setInputValue("");

    if (isStreaming) {
      addUserMessage(tabId, text);
      try {
        await sendCommand({ type: "prompt", message: text, streamingBehavior: "steer" });
      } catch (err) {
        appendError(tabId, String(err));
      }
      return;
    }

    addUserMessage(tabId, text);
    setTabStatus(tabId, "thinking");

    try {
      await sendMessage(text);
    } catch (err) {
      appendError(tabId, String(err));
      setTabStatus(tabId, null);
    }
  }, [addUserMessage, appendError, inputValue, isStreaming, ready, sendCommand, sendMessage, setTabStatus, tabId]);

  const handleInterrupt = useCallback(async () => {
    try {
      await interrupt();
    } catch (err) {
      appendError(tabId, String(err));
      setTabStatus(tabId, null);
    }
  }, [appendError, interrupt, setTabStatus, tabId]);

  const handlePermissionModeChange = useCallback(async (nextMode: PiPermissionMode) => {
    const previousMode = permissionMode;
    setPermissionMode(nextMode);

    try {
      await sendCommand({ type: "prompt", message: modeCommand(nextMode) });
      setToolbarError(null);
    } catch (err) {
      setPermissionMode(previousMode);
      appendError(tabId, String(err));
    }
  }, [appendError, permissionMode, sendCommand, tabId]);

  const handleModelChange = useCallback(async (nextModelKey: string) => {
    const nextModel = modelOptions.find((model) => modelKey(model) === nextModelKey);
    if (!nextModel) return;

    const previousModel = currentModel;
    setCurrentModel(nextModel);

    try {
      const selectedModel = await sendCommand<PiModel>({
        type: "set_model",
        provider: nextModel.provider,
        modelId: nextModel.id,
      });
      setCurrentModel(selectedModel);
      // pi clamps the thinking level to the new model's capabilities, so re-read it.
      const state = await sendCommand<PiStateResponse>({ type: "get_state" });
      const selectedThinkingLevel = state.thinkingLevel ?? thinkingLevel;
      if (state.thinkingLevel) setThinkingLevel(state.thinkingLevel);
      if (backendId) {
        savePiChatSettings(backendId, {
          provider: selectedModel.provider,
          model: selectedModel.id,
          thinkingLevel: selectedThinkingLevel,
        }).catch((err) => appendError(tabId, String(err)));
      }
      setToolbarError(null);
    } catch (err) {
      setCurrentModel(previousModel);
      appendError(tabId, String(err));
    }
  }, [appendError, backendId, currentModel, modelOptions, sendCommand, tabId, thinkingLevel]);

  const handleEffortChange = useCallback(async (nextLevel: PiThinkingLevel) => {
    const previousLevel = thinkingLevel;
    setThinkingLevel(nextLevel);

    try {
      await sendCommand({ type: "set_thinking_level", level: nextLevel });
      if (backendId) {
        savePiChatSettings(backendId, {
          provider: currentModel?.provider,
          model: currentModel?.id,
          thinkingLevel: nextLevel,
        }).catch((err) => appendError(tabId, String(err)));
      }
      setToolbarError(null);
    } catch (err) {
      setThinkingLevel(previousLevel);
      appendError(tabId, String(err));
    }
  }, [appendError, backendId, currentModel, sendCommand, tabId, thinkingLevel]);

  const focusInput = useCallback(() => {
    if (!ready) return;
    inputRef.current?.focus({ preventScroll: true });
  }, [ready]);

  const setInputValueWithSelection = useCallback((nextValue: string, start: number, end = start) => {
    pendingInputSelectionRef.current = { start, end };
    setInputValue(nextValue);
  }, []);

  const replaceInputSelection = useCallback((replacement: string) => {
    const input = inputRef.current;
    const start = input?.selectionStart ?? inputValue.length;
    const end = input?.selectionEnd ?? inputValue.length;
    const nextValue = inputValue.slice(0, start) + replacement + inputValue.slice(end);
    const nextCursor = start + replacement.length;
    setInputValueWithSelection(nextValue, nextCursor);
  }, [inputValue, setInputValueWithSelection]);

  const deleteInputSelection = useCallback((direction: "backward" | "forward") => {
    const input = inputRef.current;
    const start = input?.selectionStart ?? inputValue.length;
    const end = input?.selectionEnd ?? inputValue.length;

    if (start !== end) {
      setInputValueWithSelection(inputValue.slice(0, start) + inputValue.slice(end), start);
      return;
    }

    if (direction === "backward" && start > 0) {
      setInputValueWithSelection(inputValue.slice(0, start - 1) + inputValue.slice(end), start - 1);
      return;
    }

    if (direction === "forward" && end < inputValue.length) {
      setInputValueWithSelection(inputValue.slice(0, start) + inputValue.slice(end + 1), start);
      return;
    }

    focusInput();
  }, [focusInput, inputValue, setInputValueWithSelection]);

  const routeKeyToInput = useCallback((event: KeyboardEvent): boolean => {
    if (!ready || event.defaultPrevented || event.isComposing) return false;
    if (event.ctrlKey || event.metaKey || event.altKey) return false;

    if (event.key === "Enter") {
      if (event.shiftKey) {
        replaceInputSelection("\n");
      } else if (inputValue.trim()) {
        void handleSend();
      } else {
        focusInput();
      }
      return true;
    }

    if (event.key === "Backspace") {
      deleteInputSelection("backward");
      return true;
    }

    if (event.key === "Delete") {
      deleteInputSelection("forward");
      return true;
    }

    if (event.key.length === 1) {
      replaceInputSelection(event.key);
      return true;
    }

    return false;
  }, [deleteInputSelection, focusInput, handleSend, inputValue, ready, replaceInputSelection]);

  useEffect(() => {
    if (activeSessionId !== tabId) {
      keyboardCaptureRef.current = false;
      return;
    }

    function handleDocumentPointerDown(event: PointerEvent) {
      keyboardCaptureRef.current = Boolean(viewRef.current?.contains(event.target as Node));
    }

    function handleDocumentKeyDown(event: KeyboardEvent) {
      if (!keyboardCaptureRef.current || isInteractiveTarget(event.target)) return;
      if (!routeKeyToInput(event)) return;

      event.preventDefault();
      event.stopPropagation();
    }

    function handleDocumentPaste(event: ClipboardEvent) {
      if (!keyboardCaptureRef.current || isInteractiveTarget(event.target) || !ready) return;

      const text = event.clipboardData?.getData("text/plain");
      if (!text) return;

      event.preventDefault();
      event.stopPropagation();
      replaceInputSelection(text);
    }

    document.addEventListener("pointerdown", handleDocumentPointerDown, true);
    document.addEventListener("keydown", handleDocumentKeyDown, true);
    document.addEventListener("paste", handleDocumentPaste, true);
    return () => {
      document.removeEventListener("pointerdown", handleDocumentPointerDown, true);
      document.removeEventListener("keydown", handleDocumentKeyDown, true);
      document.removeEventListener("paste", handleDocumentPaste, true);
    };
  }, [activeSessionId, ready, replaceInputSelection, routeKeyToInput, tabId]);

  const handleViewMouseDown = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.button !== 0 || isInteractiveTarget(event.target)) return;

    keyboardCaptureRef.current = true;
    if (!isSelectableChatTarget(event.target)) event.preventDefault();
    focusInput();
  }, [focusInput]);

  const handleViewMouseUp = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (isInteractiveTarget(event.target)) return;

    keyboardCaptureRef.current = true;
    if (window.getSelection()?.toString()) return;

    requestAnimationFrame(focusInput);
  }, [focusInput]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  return (
    <div ref={viewRef} className="pi-chat-view" onMouseDown={handleViewMouseDown} onMouseUp={handleViewMouseUp} style={chatStyle}>
      <div className="pi-chat-top-actions" ref={loadMenuRef}>
        <button
          type="button"
          className="pi-chat-load-trigger"
          onClick={handleLoadMenuToggle}
          disabled={!ready || isStreaming}
        >
          :load
        </button>
        {loadMenuOpen && (
          <div className="pi-chat-load-dropdown">
            {loadSessionsLoading && <div className="pi-chat-load-empty">loading sessions...</div>}
            {loadSessionsError && <div className="pi-chat-load-empty">error: {loadSessionsError}</div>}
            {!loadSessionsLoading && !loadSessionsError && loadSessions.length === 0 && (
              <div className="pi-chat-load-empty">no pi sessions for this project</div>
            )}
            {!loadSessionsLoading && loadSessions.map((session) => (
              <button
                type="button"
                key={session.path}
                className="pi-chat-load-option"
                onClick={() => handleLoadSession(session)}
                title={session.path}
              >
                <span className="pi-chat-load-marker">{">"}</span>
                <span className="pi-chat-load-main">
                  <span className="pi-chat-load-name">{sessionDisplayName(session)}</span>
                  <span className="pi-chat-load-meta">{session.messageCount} msg · {formatSessionAge(session.modified)} ago</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="pi-chat-log" ref={scrollRef}>
        {messages.length === 0 ? (
          <div className="pi-chat-empty">{ready ? "send a message to pi..." : "starting pi..."}</div>
        ) : (
          messages.map((message) => <PiChatMessageView message={message} key={message.id} />)
        )}
        {isStreaming && (
          <div className="pi-chat-working">
            <span className="pi-chat-working-mark" aria-hidden="true" />
            <span>Working...</span>
          </div>
        )}

      </div>

      <div className="pi-chat-input-shell">
        <div className={`pi-chat-composer${isStreaming ? " pi-chat-composer--running" : ""}`}>
          <div className="pi-chat-composer-main">
            <textarea
              ref={inputRef}
              className="pi-chat-input"
              value={inputValue}
              onChange={(event) => setInputValue(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={ready ? (isStreaming ? "type a steering message..." : "type a message...") : "starting pi..."}
              rows={2}
              disabled={!ready}
            />
          </div>

          <div className="pi-chat-controls-row">
            <PiChatSelect
              ariaLabel="permissions mode"
              className={`pi-chat-permission-select pi-chat-permission-select--${permissionMode}`}
              value={permissionMode}
              onChange={handlePermissionModeChange}
              disabled={!ready}
              triggerPrefix="permissions: "
              options={[
                { value: "default", label: "default" },
                { value: "bypassPermissions", label: "bypass" },
              ]}
            />

            {isStreaming && (
              <button className="pi-chat-command" onClick={handleInterrupt}>
                :interrupt
              </button>
            )}

            <div className="pi-chat-controls-right">
              <PiChatSelect
                ariaLabel="reasoning effort"
                className="pi-chat-effort-select"
                value={effortValue}
                onChange={handleEffortChange}
                disabled={!ready || isStreaming || effortLevels.length <= 1}
                triggerPrefix="effort: "
                options={effortLevels.map((level) => ({ value: level, label: level }))}
              />

              <PiChatSelect
                ariaLabel="model selector"
                className="pi-chat-model-select"
                value={currentModelKey}
                onChange={handleModelChange}
                disabled={!ready || isStreaming || modelOptions.length === 0}
                options={modelOptions.length === 0
                  ? [{ value: "", label: "model" }]
                  : modelOptions.map((model) => ({ value: modelKey(model), label: modelOptionLabel(model, duplicateModelIds) }))}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
