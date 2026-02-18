import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Channel } from "@tauri-apps/api/core";
import {
  attachPtySessionStream,
  closePtySession,
  createPtySession,
  detachPtySessionStream,
  saveClipboardImage,
  resizePtySession,
  writePtySession,
} from "../lib/pty";
import { useSessionStore } from "../stores/sessionStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useProjectStore } from "../stores/projectStore";
import { useVoiceStore } from "../stores/voiceStore";
import { THEMES } from "../lib/themes";
import { regenerateCodexTitle } from "../lib/codexTitles";
import { PtyOutputEvent, SessionType } from "../types";
import "@xterm/xterm/css/xterm.css";

/** Check if any of the last N lines near the cursor contain an interactive prompt indicator */
function hasQuestionPrompt(terminal: Terminal): boolean {
  const buf = terminal.buffer.active;
  const cursorY = buf.baseY + buf.cursorY;
  const startY = Math.max(0, cursorY - 11);
  for (let y = startY; y <= cursorY; y++) {
    const line = buf.getLine(y);
    if (!line) continue;
    const text = line.translateToString(true);
    if (text.includes("Would you like to proceed?") || text.includes("Chat about this")) {
      return true;
    }
  }
  return false;
}

interface TerminalViewProps {
  tabId: string;
  projectPath: string;
  projectName: string;
  sessionType: SessionType;
  hideTitleBar?: boolean;
  onClose: () => void;
}

const DEBUG_PTY_LIFECYCLE = false;

function logPtyLifecycle(message: string, details?: Record<string, unknown>) {
  if (!DEBUG_PTY_LIFECYCLE) return;
  console.debug("[TerminalView]", message, details ?? {});
}

function fitTerminalAndScrollToBottom(terminal: Terminal, fitAddon: FitAddon) {
  fitAddon.fit();
  terminal.scrollToBottom();
  requestAnimationFrame(() => terminal.scrollToBottom());
}

export function TerminalView({ tabId, projectPath, projectName, sessionType, hideTitleBar, onClose }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const persistedTitle = useSessionStore((s) => s.sessionTitles.get(tabId) ?? projectName);
  const [title, setTitle] = useState(persistedTitle);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const subscriberIdRef = useRef<string | null>(null);
  const spawnGenerationRef = useRef(0);
  const initializedRef = useRef(false);
  const updateSessionPtyId = useSessionStore((s) => s.updateSessionPtyId);
  const setSessionTitle = useSessionStore((s) => s.setSessionTitle);
  const setTabStatus = useSessionStore((s) => s.setTabStatus);
  const activeProjectPath = useSessionStore((s) => s.activeProjectPath);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const settings = useSettingsStore((s) => s.settings);
  const projectTheme = useProjectStore(
    (s) => s.projects.find((p) => p.path === projectPath)?.theme ?? "midnight"
  );
  const voiceStatusMessage = useVoiceStore((s) => s.statusMessage);
  const voiceTargetTabId = useVoiceStore((s) => s.targetTabId);
  const [showCopied, setShowCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [screenshotStatus, setScreenshotStatus] = useState<string | null>(null);
  const screenshotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusLineMessage = voiceTargetTabId === tabId ? voiceStatusMessage : null;

  useEffect(() => {
    setTitle(persistedTitle);
  }, [persistedTitle]);

  useEffect(() => {
    if (!containerRef.current || initializedRef.current) return;
    const containerEl = containerRef.current;
    initializedRef.current = true;
    const spawnGeneration = ++spawnGenerationRef.current;
    let cleanedUp = false;
    let activityTimer: ReturnType<typeof setTimeout> | null = null;
    let codexAutoTitleTimer: ReturnType<typeof setTimeout> | null = null;
    let codexSpawnedAtMs: number | null = null;
    let codexTitleInFlight = false;
    let lastUserInputTime = 0;
    logPtyLifecycle("mount:init", { tabId, sessionType, projectPath, spawnGeneration });

    const refreshCodexTitle = async (): Promise<boolean> => {
      if (sessionType !== "codex") return false;
      if (codexSpawnedAtMs === null) return false;
      if (codexTitleInFlight) return false;
      codexTitleInFlight = true;
      try {
        const generatedTitle = await regenerateCodexTitle(projectPath, codexSpawnedAtMs);
        if (!generatedTitle) return false;
        if (cleanedUp || spawnGenerationRef.current !== spawnGeneration) return false;
        setTitle(generatedTitle);
        setSessionTitle(tabId, generatedTitle);
        return true;
      } catch {
        return false;
      } finally {
        codexTitleInFlight = false;
      }
    };

    const maybeAutoGenerateCodexTitle = () => {
      if (sessionType !== "codex") return;
      const store = useSessionStore.getState();
      if (store.codexAutoTitleDone.has(tabId)) return;
      if (codexSpawnedAtMs === null) {
        codexSpawnedAtMs = Date.now();
      }
      void refreshCodexTitle().then((generated) => {
        if (generated) {
          useSessionStore.getState().markCodexAutoTitleDone(tabId);
        }
      });
    };

    const currentSettings = useSettingsStore.getState().settings;
    const currentProjectTheme = useProjectStore.getState().projects.find((p) => p.path === projectPath)?.theme ?? "midnight";
    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: "bar",
      fontSize: currentSettings.terminalFontSize,
      fontFamily: currentSettings.terminalFontFamily,
      theme: THEMES[currentProjectTheme].xterm,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new WebLinksAddon());
    terminal.open(containerEl);

    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => {
        webglAddon.dispose();
      });
      terminal.loadAddon(webglAddon);
    } catch {
      // WebGL not available, fall back to DOM renderer
    }

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    requestAnimationFrame(() => {
      fitTerminalAndScrollToBottom(terminal, fitAddon);
      const channel = new Channel<PtyOutputEvent>();
      channel.onmessage = (event: PtyOutputEvent) => {
        if (cleanedUp || spawnGenerationRef.current !== spawnGeneration) return;
        if (event.type === "Data") {
          const bytes = new Uint8Array(event.data.bytes);
          terminal.write(bytes);
          const timeSinceInput = Date.now() - lastUserInputTime;
          if (timeSinceInput > 150) {
            setTabStatus(tabId, "thinking");
            if (activityTimer) clearTimeout(activityTimer);
            activityTimer = setTimeout(() => {
              if (hasQuestionPrompt(terminal)) {
                setTabStatus(tabId, "waiting");
              } else {
                setTabStatus(tabId, null);
              }
              activityTimer = null;
            }, 2000);
          }
        } else if (event.type === "Exit") {
          terminal.write("\r\n\x1b[90m[Process exited]\x1b[0m\r\n");
          if (activityTimer) { clearTimeout(activityTimer); activityTimer = null; }
          setTabStatus(tabId, null);
        } else if (event.type === "Closed") {
          terminal.write(`\r\n\x1b[90m[Session closed: ${event.data.reason}]\x1b[0m\r\n`);
          if (activityTimer) { clearTimeout(activityTimer); activityTimer = null; }
          setTabStatus(tabId, null);
        } else if (event.type === "Error") {
          terminal.write(`\r\n\x1b[31m${event.data.message}\x1b[0m\r\n`);
        }
      };

      const cols = terminal.cols;
      const rows = terminal.rows;

      const ensureSessionAndAttach = async () => {
        let sid = useSessionStore
          .getState()
          .sessions
          .find((session) => session.id === tabId)
          ?.sessionId ?? null;

        if (!sid) {
          if (sessionType === "codex") {
            codexSpawnedAtMs = Date.now();
          }
          const created = await createPtySession({
            projectPath,
            cols,
            rows,
            sessionType,
            continueSession: false,
          });
          sid = created.sessionId;
          if (cleanedUp || spawnGenerationRef.current !== spawnGeneration) {
            void closePtySession(sid).catch(() => {});
            return;
          }
          updateSessionPtyId(tabId, sid);
        } else if (sessionType === "codex") {
          codexSpawnedAtMs = Date.now();
        }

        if (cleanedUp || spawnGenerationRef.current !== spawnGeneration) return;
        sessionIdRef.current = sid;
        const attached = await attachPtySessionStream(sid, channel, null);
        if (cleanedUp || spawnGenerationRef.current !== spawnGeneration) {
          void detachPtySessionStream(sid, attached.subscriberId).catch(() => {});
          return;
        }
        subscriberIdRef.current = attached.subscriberId;
        void resizePtySession(sid, terminal.cols, terminal.rows).catch(() => {});
        logPtyLifecycle("stream:attached", { tabId, spawnGeneration, sid, subscriberId: attached.subscriberId });
      };

      ensureSessionAndAttach().catch((err) => {
        if (!cleanedUp && spawnGenerationRef.current === spawnGeneration) {
          logPtyLifecycle("attach:error", { tabId, spawnGeneration, error: String(err) });
          terminal.write(`\r\n\x1b[31mFailed to initialize terminal session: ${err}\x1b[0m\r\n`);
        }
      });
    });

    const onDataDisposable = terminal.onData((data) => {
      lastUserInputTime = Date.now();
      const currentStatus = useSessionStore.getState().tabStatuses.get(tabId);
      if (currentStatus === "waiting") {
        setTabStatus(tabId, null);
      }
      if (sessionIdRef.current) {
        const encoder = new TextEncoder();
        writePtySession(sessionIdRef.current, encoder.encode(data)).catch(() => {});
      }
      if (sessionType === "codex" && (data.includes("\r") || data.includes("\n"))) {
        if (codexAutoTitleTimer) return;
        codexAutoTitleTimer = setTimeout(() => {
          codexAutoTitleTimer = null;
          maybeAutoGenerateCodexTitle();
        }, 800);
      }
    });

    const onResizeDisposable = terminal.onResize(({ cols, rows }) => {
      if (sessionIdRef.current) {
        resizePtySession(sessionIdRef.current, cols, rows).catch(() => {});
      }
    });

    const onTitleDisposable = terminal.onTitleChange((nextTitle) => {
      const clean = nextTitle.replace(/^[^\x20-\x7E]+\s*/, "").trim() || nextTitle;
      setTitle(clean);
      setSessionTitle(tabId, clean);
    });

    const onSelectionDisposable = terminal.onSelectionChange(() => {
      const selection = terminal.getSelection();
      if (selection) {
        navigator.clipboard.writeText(selection).then(() => {
          terminal.clearSelection();
          if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
          setShowCopied(true);
          copiedTimerRef.current = setTimeout(() => setShowCopied(false), 1500);
        }).catch(() => {});
      }
    });

    const showScreenshotStatus = (message: string) => {
      setScreenshotStatus(message);
      if (screenshotTimerRef.current) clearTimeout(screenshotTimerRef.current);
      screenshotTimerRef.current = setTimeout(() => setScreenshotStatus(null), 2000);
    };

    const pasteImageBlob = async (imageBlob: Blob, mimeType: string) => {
      const sid = sessionIdRef.current;
      if (!sid) {
        showScreenshotStatus("no active session");
        return;
      }

      const buffer = await imageBlob.arrayBuffer();
      const data = Array.from(new Uint8Array(buffer));
      const filePath = await saveClipboardImage(data, mimeType);
      const encoder = new TextEncoder();
      await writePtySession(sid, encoder.encode(filePath));
      showScreenshotStatus("screenshot pasted");
    };

    const handleClipboardPaste = async (clipboardEvent?: ClipboardEvent) => {
      let imageBlob: Blob | null = null;
      let mimeType = "";

      const eventItems = clipboardEvent?.clipboardData?.items;
      if (eventItems) {
        for (const item of eventItems) {
          if (item.type.startsWith("image/")) {
            const file = item.getAsFile();
            if (file) {
              imageBlob = file;
              mimeType = item.type;
              break;
            }
          }
        }
      }

      if (!imageBlob && navigator.clipboard && typeof navigator.clipboard.read === "function") {
        try {
          const items = await navigator.clipboard.read();
          for (const item of items) {
            for (const type of item.types) {
              if (type.startsWith("image/")) {
                imageBlob = await item.getType(type);
                mimeType = type;
                break;
              }
            }
            if (imageBlob) break;
          }
        } catch {
          // Ignore and fall back to text clipboard APIs below.
        }
      }

      if (imageBlob) {
        await pasteImageBlob(imageBlob, mimeType || "image/png");
        return;
      }

      let text = clipboardEvent?.clipboardData?.getData("text/plain") ?? "";
      if (!text) {
        try {
          text = await navigator.clipboard.readText();
        } catch {
          text = "";
        }
      }
      if (text) terminal.paste(text);
    };

    const onPasteCapture = (ev: ClipboardEvent) => {
      ev.preventDefault();
      ev.stopPropagation();
      void handleClipboardPaste(ev);
    };
    containerEl.addEventListener("paste", onPasteCapture, true);

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry || entry.contentRect.width === 0 || entry.contentRect.height === 0) return;
      requestAnimationFrame(() => {
        fitTerminalAndScrollToBottom(terminal, fitAddon);
      });
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      cleanedUp = true;
      logPtyLifecycle("mount:cleanup:start", { tabId, spawnGeneration });

      if (activityTimer) clearTimeout(activityTimer);
      if (codexAutoTitleTimer) clearTimeout(codexAutoTitleTimer);
      containerEl.removeEventListener("paste", onPasteCapture, true);
      setTabStatus(tabId, null);
      resizeObserver.disconnect();
      onDataDisposable.dispose();
      onResizeDisposable.dispose();
      onTitleDisposable.dispose();
      onSelectionDisposable.dispose();
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      if (screenshotTimerRef.current) clearTimeout(screenshotTimerRef.current);

      const sid = sessionIdRef.current;
      const subscriberId = subscriberIdRef.current;
      sessionIdRef.current = null;
      subscriberIdRef.current = null;
      if (sid && subscriberId) {
        void detachPtySessionStream(sid, subscriberId).catch(() => {});
      }

      terminal.dispose();
      initializedRef.current = false;
      logPtyLifecycle("mount:cleanup:done", { tabId, spawnGeneration });
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPath, tabId, sessionType]);

  useEffect(() => {
    if (activeProjectPath !== projectPath) return;
    if (activeSessionId !== tabId) return;
    const raf = requestAnimationFrame(() => {
      const terminal = terminalRef.current;
      const fitAddon = fitAddonRef.current;
      if (!terminal) return;
      if (fitAddon) fitTerminalAndScrollToBottom(terminal, fitAddon);
      terminal.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [activeProjectPath, projectPath, activeSessionId, tabId]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;

    terminal.options.fontSize = settings.terminalFontSize;
    terminal.options.fontFamily = settings.terminalFontFamily;
    terminal.options.theme = THEMES[projectTheme].xterm;
    const fitAddon = fitAddonRef.current;
    if (fitAddon) fitTerminalAndScrollToBottom(terminal, fitAddon);
  }, [settings.terminalFontSize, settings.terminalFontFamily, projectTheme]);

  return (
    <div className="terminal-view">
      {!hideTitleBar && (
        <div className="terminal-title-bar">
          <span className="terminal-title-text" title={title}>{title}</span>
          <button className="terminal-title-close" onClick={onClose} title="Close session">x</button>
        </div>
      )}
      <div className="terminal-container" ref={containerRef} />
      {statusLineMessage ? (
        <div className="terminal-status-line">{statusLineMessage}</div>
      ) : screenshotStatus ? (
        <div className="terminal-status-line">{screenshotStatus}</div>
      ) : showCopied ? (
        <div className="terminal-status-line">copied to clipboard</div>
      ) : null}
    </div>
  );
}
