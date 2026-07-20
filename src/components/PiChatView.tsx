import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { usePiSession } from "../hooks/usePiSession";
import { listPiSessions, savePiChatSettings, type PiSessionInfo } from "../lib/pi";
import { THEMES } from "../lib/themes";
import { usePiChatStore, type PiChatMessage } from "../stores/piChatStore";
import { useProjectStore } from "../stores/projectStore";
import { useSessionStore } from "../stores/sessionStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useVoiceStore } from "../stores/voiceStore";
import type { PiModel, PiPermissionMode, PiThinkingLevel } from "../lib/piRpc";
import { getSupportedThinkingLevels } from "../lib/piRpc";
import { changedFilesForMessages, PiChatMessageView, type ChangedFilesBundle } from "./PiChatBlocks";
import { VoiceTranscriptBox } from "./VoiceTranscriptBox";
import "./PiChatView.css";

const MicIcon = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0" />
    <line x1="12" y1="18" x2="12" y2="21" />
  </svg>
);

const SendIcon = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="12" y1="19" x2="12" y2="6" />
    <polyline points="6 12 12 6 18 12" />
  </svg>
);

const StopIcon = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <rect x="5" y="5" width="14" height="14" rx="2" />
  </svg>
);

interface PiChatViewProps {
  tabId: string;
  projectPath: string;
  agentSessionId: string;
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

interface PiForkMessagesResponse {
  messages?: unknown[];
}

interface PiCommandsResponse {
  commands?: unknown[];
}

interface PiForkMessage {
  entryId: string;
  text: string;
}

type RewindMode = "conversation" | "code";

interface RewindDialogState {
  entryId: string;
  text: string;
  files: string[];
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

function useSettledStreaming(isStreaming: boolean, delayMs = 450): boolean {
  const [settledStreaming, setSettledStreaming] = useState(isStreaming);

  useEffect(() => {
    if (isStreaming) {
      setSettledStreaming(true);
      return;
    }

    const timer = setTimeout(() => setSettledStreaming(false), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs, isStreaming]);

  return settledStreaming;
}

function workingStatusLabel(effort: PiThinkingLevel): string {
  return effort === "off" ? "Working..." : `Working... (thinking with ${effort} effort)`;
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function getPiChatMessageText(message: PiChatMessage): string {
  const first = message.blocks[0];
  return first?.type === "text" ? first.content : "";
}

function normalizeForkMessages(response: PiForkMessagesResponse): PiForkMessage[] {
  if (!Array.isArray(response.messages)) return [];

  return response.messages.flatMap((raw): PiForkMessage[] => {
    const item = readObject(raw);
    const entryId = readText(item?.entryId).trim();
    const text = readText(item?.text);
    return entryId ? [{ entryId, text }] : [];
  });
}

function buildRewindTargetMap(messages: readonly PiChatMessage[], targets: readonly PiForkMessage[]): Map<string, string> {
  const result = new Map<string, string>();
  let targetIndex = 0;

  for (const message of messages) {
    if (message.role !== "user") continue;
    const text = getPiChatMessageText(message);

    for (let index = targetIndex; index < targets.length; index += 1) {
      if (targets[index]?.text !== text) continue;
      result.set(message.id, targets[index].entryId);
      targetIndex = index + 1;
      break;
    }
  }

  return result;
}

function findRewindCommandName(response: PiCommandsResponse): string | null {
  if (!Array.isArray(response.commands)) return null;
  const names = response.commands
    .map((raw) => readText(readObject(raw)?.name))
    .filter(Boolean);
  return names.find((name) => name === "rewind-to") ?? names.find((name) => name.startsWith("rewind-to:")) ?? null;
}

function buildTurnChangeSummaries(messages: readonly PiChatMessage[], projectPath: string, isStreaming: boolean): Map<string, ChangedFilesBundle> {
  const summaries = new Map<string, ChangedFilesBundle>();
  const sessionChanges = changedFilesForMessages([...messages], projectPath);
  let turnStart = -1;

  for (let index = 0; index <= messages.length; index += 1) {
    const message = messages[index];
    const isBoundary = index === messages.length || message?.role === "user";
    if (!isBoundary) continue;

    const start = turnStart + 1;
    const end = index;
    const isCurrentTurn = end === messages.length;

    if (end > start && !(isStreaming && isCurrentTurn)) {
      const turnMessages = messages.slice(start, end);
      const lastAssistant = [...turnMessages].reverse().find((candidate) => candidate.role === "assistant");
      const turnChanges = changedFilesForMessages(turnMessages, projectPath);
      if (lastAssistant && turnChanges.files.length > 0) {
        summaries.set(lastAssistant.id, {
          files: turnChanges.files,
          turnHunks: turnChanges.hunks,
          sessionHunks: sessionChanges.hunks,
        });
      }
    }

    turnStart = index;
  }

  return summaries;
}

function PiChatSelect<T extends string>({
  ariaLabel,
  className,
  disabled,
  options,
  value,
  onChange,
  triggerPrefix,
  triggerIcon,
}: {
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  options: Array<PiChatSelectOption<T>>;
  value: T;
  onChange: (value: T) => void;
  triggerPrefix?: string;
  triggerIcon?: ReactNode;
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
        {triggerIcon && <span className="pi-chat-select-icon">{triggerIcon}</span>}
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

export function PiChatView({ tabId, projectPath, agentSessionId }: PiChatViewProps) {
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
  const [rewindTargets, setRewindTargets] = useState<PiForkMessage[]>([]);
  const [rewindDialog, setRewindDialog] = useState<RewindDialogState | null>(null);
  const [rewindBusy, setRewindBusy] = useState(false);
  const [, setToolbarError] = useState<string | null>(null);

  const messages = usePiChatStore(
    useCallback((state) => state.chats.get(tabId) ?? EMPTY_MESSAGES, [tabId]),
  );
  const isStreaming = usePiChatStore(
    useCallback((state) => state.streamingTabs.has(tabId), [tabId]),
  );
  const showStreamingUi = useSettledStreaming(isStreaming);
  const voiceActive = useVoiceStore(
    useCallback((state) => state.isListening && state.targetTabId === tabId, [tabId]),
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
  const { ready, backendId, sendMessage, sendCommand, interrupt } = usePiSession({ tabId, projectPath, agentSessionId });

  const changeSummaries = buildTurnChangeSummaries(messages, projectPath, showStreamingUi);
  const userMessageCount = messages.filter((message) => message.role === "user").length;
  const rewindEntryIds = useMemo(() => buildRewindTargetMap(messages, rewindTargets), [messages, rewindTargets]);

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
        if (stateResponse.sessionName) setSessionTitle(tabId, `pi: ${stateResponse.sessionName}`);
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
  }, [ready, sendCommand, setSessionTitle, tabId]);

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
    const [messagesResponse, forkMessagesResponse] = await Promise.all([
      sendCommand<PiMessagesResponse>({ type: "get_messages" }),
      sendCommand<PiForkMessagesResponse>({ type: "get_fork_messages" }),
    ]);
    setMessagesFromPi(tabId, Array.isArray(messagesResponse.messages) ? messagesResponse.messages : []);
    setRewindTargets(normalizeForkMessages(forkMessagesResponse));
  }, [sendCommand, setMessagesFromPi, tabId]);

  useEffect(() => {
    if (ready) void loadCurrentMessages();
  }, [loadCurrentMessages, ready]);

  const refreshRewindTargets = useCallback(async () => {
    if (!ready) return;
    try {
      const response = await sendCommand<PiForkMessagesResponse>({ type: "get_fork_messages" });
      setRewindTargets(normalizeForkMessages(response));
    } catch {
      setRewindTargets([]);
    }
  }, [ready, sendCommand]);

  useEffect(() => {
    if (!ready) {
      setRewindTargets([]);
      return;
    }
    if (isStreaming) return;
    void refreshRewindTargets();
  }, [isStreaming, ready, refreshRewindTargets, userMessageCount]);

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

  // Reuse the global Ctrl+Space voice flow, which targets the active session (this pi tab).
  const handleMicToggle = useCallback(() => {
    if (!ready) return;
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", key: " ", ctrlKey: true, bubbles: true }));
  }, [ready]);

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

  const handleOpenRewindDialog = useCallback((message: PiChatMessage, index: number, entryId: string) => {
    if (!ready || isStreaming || rewindBusy) return;
    const changes = changedFilesForMessages(messages.slice(index + 1), projectPath);
    setRewindDialog({
      entryId,
      text: getPiChatMessageText(message),
      files: changes.files.map((file) => file.path),
    });
  }, [isStreaming, messages, projectPath, ready, rewindBusy]);

  const handleCloseRewindDialog = useCallback(() => {
    if (!rewindBusy) setRewindDialog(null);
  }, [rewindBusy]);

  const handleConfirmRewind = useCallback(async (mode: RewindMode) => {
    const target = rewindDialog;
    if (!target || !ready || isStreaming || rewindBusy) return;

    setRewindBusy(true);
    setTabStatus(tabId, "thinking");
    try {
      const commandName = findRewindCommandName(await sendCommand<PiCommandsResponse>({ type: "get_commands" }));
      if (!commandName) {
        throw new Error("Pi rewind command is not available. Reload Pi extensions and try again.");
      }

      await sendCommand({
        type: "prompt",
        message: `/${commandName} ${JSON.stringify({ entryId: target.entryId, mode })}`,
      });
      await loadCurrentMessages();
      setInputValueWithSelection(target.text, target.text.length);
      setRewindDialog(null);
      setToolbarError(null);
    } catch (err) {
      appendError(tabId, String(err));
    } finally {
      setRewindBusy(false);
      setTabStatus(tabId, null);
    }
  }, [appendError, isStreaming, loadCurrentMessages, ready, rewindBusy, rewindDialog, sendCommand, setInputValueWithSelection, setTabStatus, tabId]);

  useEffect(() => {
    if (!rewindDialog) return;

    function handleKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      handleCloseRewindDialog();
    }

    window.addEventListener("keydown", handleKey, true);
    return () => window.removeEventListener("keydown", handleKey, true);
  }, [handleCloseRewindDialog, rewindDialog]);

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
      if (rewindDialog || !keyboardCaptureRef.current || isInteractiveTarget(event.target)) return;
      if (!routeKeyToInput(event)) return;

      event.preventDefault();
      event.stopPropagation();
    }

    function handleDocumentPaste(event: ClipboardEvent) {
      if (rewindDialog || !keyboardCaptureRef.current || isInteractiveTarget(event.target) || !ready) return;

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
  }, [activeSessionId, ready, replaceInputSelection, rewindDialog, routeKeyToInput, tabId]);

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
          messages.map((message, index) => {
            const rewindEntryId = message.role === "user" ? rewindEntryIds.get(message.id) : undefined;
            return (
              <PiChatMessageView
                message={message}
                projectPath={projectPath}
                changeSummary={changeSummaries.get(message.id)}
                onRewind={rewindEntryId ? () => handleOpenRewindDialog(message, index, rewindEntryId) : undefined}
                rewindDisabled={!ready || isStreaming || rewindBusy}
                key={message.id}
              />
            );
          })
        )}
        {showStreamingUi && (
          <div className="pi-chat-working">
            <span className="pi-chat-working-mark" aria-hidden="true" />
            <span>{workingStatusLabel(effortValue)}</span>
          </div>
        )}

      </div>

      {rewindDialog && (
        <div
          className="pi-chat-rewind-backdrop"
          onMouseDown={(event) => {
            event.stopPropagation();
            if (event.target === event.currentTarget) handleCloseRewindDialog();
          }}
        >
          <div className="pi-chat-rewind-dialog" role="dialog" aria-modal="true" aria-label="rewind conversation">
            <div className="pi-chat-rewind-title">rewind conversation</div>
            <div className="pi-chat-rewind-preview">{rewindDialog.text || "(empty message)"}</div>
            <div className="pi-chat-rewind-options">
              <button
                type="button"
                className="pi-chat-rewind-option"
                onClick={() => handleConfirmRewind("conversation")}
                disabled={rewindBusy}
              >
                <span className="pi-chat-rewind-marker">{">"}</span>
                <span className="pi-chat-rewind-option-main">
                  <span>conversation only</span>
                  <span className="pi-chat-rewind-option-meta">move pi back to this message and restore it to the editor</span>
                </span>
              </button>
              <button
                type="button"
                className="pi-chat-rewind-option"
                onClick={() => handleConfirmRewind("code")}
                disabled={rewindBusy || rewindDialog.files.length === 0}
              >
                <span className="pi-chat-rewind-marker">{">"}</span>
                <span className="pi-chat-rewind-option-main">
                  <span>conversation + code changes</span>
                  <span className="pi-chat-rewind-option-meta">
                    {rewindDialog.files.length > 0
                      ? `also try to undo pi edits in ${rewindDialog.files.length} file${rewindDialog.files.length === 1 ? "" : "s"}`
                      : "no code changes detected after this message"}
                  </span>
                </span>
              </button>
            </div>
            {rewindDialog.files.length > 0 && (
              <div className="pi-chat-rewind-files">
                {rewindDialog.files.slice(0, 5).map((file) => <div key={file}>• {file}</div>)}
                {rewindDialog.files.length > 5 && <div>• … {rewindDialog.files.length - 5} more</div>}
              </div>
            )}
            <div className="pi-chat-rewind-footer">
              <button type="button" className="pi-chat-rewind-cancel" onClick={handleCloseRewindDialog} disabled={rewindBusy}>
                :cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="pi-chat-input-shell">
        <VoiceTranscriptBox
          tabId={tabId}
          onSubmit={(text) => {
            setInputValue((prev) => (prev ? `${prev} ${text}` : text));
            focusInput();
          }}
        />
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
              triggerIcon={permissionMode === "bypassPermissions" ? "⚠" : "✓"}
              options={[
                { value: "default", label: "default" },
                { value: "bypassPermissions", label: "bypass" },
              ]}
            />

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

              <button
                type="button"
                className={`pi-chat-mic-btn${voiceActive ? " pi-chat-mic-btn--active" : ""}`}
                onClick={handleMicToggle}
                disabled={!ready}
                aria-label={voiceActive ? "stop voice input" : "start voice input"}
                title={voiceActive ? "stop voice input" : "voice input (ctrl+space)"}
              >
                {MicIcon}
              </button>

              <button
                type="button"
                className={`pi-chat-send-btn${isStreaming ? " pi-chat-send-btn--stop" : ""}`}
                onClick={isStreaming ? handleInterrupt : handleSend}
                disabled={isStreaming ? !ready : (!ready || !inputValue.trim())}
                aria-label={isStreaming ? "stop" : "send"}
                title={isStreaming ? "stop" : "send"}
              >
                {isStreaming ? StopIcon : SendIcon}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
