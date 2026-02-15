import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Channel } from "@tauri-apps/api/core";
import { spawnSession, spawnShell, spawnOpencode, spawnCodex, writeSession, resizeSession, killSession, saveClipboardImage } from "../lib/pty";
import { useSessionStore } from "../stores/sessionStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useProjectStore } from "../stores/projectStore";
import { useVoiceStore } from "../stores/voiceStore";
import { THEMES } from "../lib/themes";
import { regenerateCodexTitle } from "../lib/codexTitles";
import { PtyOutputEvent, SessionType } from "../types";
import "@xterm/xterm/css/xterm.css";

/** Scan raw PTY bytes for ESC[2J (clear entire screen) */
function hasClearScreen(data: Uint8Array): boolean {
  for (let i = 0; i + 3 < data.length; i++) {
    if (data[i] === 0x1b && data[i + 1] === 0x5b && data[i + 2] === 0x32 && data[i + 3] === 0x4a) {
      return true;
    }
  }
  return false;
}

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

export function TerminalView({ tabId, projectPath, projectName, sessionType, hideTitleBar, onClose }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const [title, setTitle] = useState(projectName);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
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
    if (!containerRef.current || initializedRef.current) return;
    const containerEl = containerRef.current;
    initializedRef.current = true;
    const spawnGeneration = ++spawnGenerationRef.current;
    let cleanedUp = false;
    let titleChangedDuringWrite = false;
    let titleResetTimer: ReturnType<typeof setTimeout> | null = null;
    let activityTimer: ReturnType<typeof setTimeout> | null = null;
    let codexTitleTimer: ReturnType<typeof setTimeout> | null = null;
    let codexSpawnedAtMs: number | null = null;
    let codexTitleInFlight = false;
    let lastUserInputTime = 0;
    logPtyLifecycle("mount:init", { tabId, sessionType, projectPath, spawnGeneration });

    const refreshCodexTitle = () => {
      if (sessionType !== "codex") return;
      if (codexSpawnedAtMs === null) return;
      if (codexTitleInFlight) return;
      codexTitleInFlight = true;
      regenerateCodexTitle(projectPath, codexSpawnedAtMs)
        .then((generatedTitle) => {
          if (!generatedTitle) return;
          if (cleanedUp || spawnGenerationRef.current !== spawnGeneration) return;
          setTitle(generatedTitle);
          setSessionTitle(tabId, generatedTitle);
        })
        .catch(() => {})
        .finally(() => {
          codexTitleInFlight = false;
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
      fitAddon.fit();

      const channel = new Channel<PtyOutputEvent>();
      channel.onmessage = (event: PtyOutputEvent) => {
        if (cleanedUp || spawnGenerationRef.current !== spawnGeneration) return;
        if (event.type === "Data" && Array.isArray(event.data)) {
          const bytes = new Uint8Array(event.data);
          titleChangedDuringWrite = false;
          terminal.write(bytes);
          // When screen is cleared (e.g. /clear), reset title to project name
          // unless a new OSC title already arrived in the same data chunk
          if (hasClearScreen(bytes) && !titleChangedDuringWrite) {
            if (titleResetTimer) clearTimeout(titleResetTimer);
            titleResetTimer = setTimeout(() => {
              setTitle(projectName);
              setSessionTitle(tabId, projectName);
              titleResetTimer = null;
            }, 150);
          }
          // Activity detection: only trigger if data isn't just PTY echo from user typing
          const timeSinceInput = Date.now() - lastUserInputTime;
          if (timeSinceInput > 150) {
            setTabStatus(tabId, "thinking");
            if (activityTimer) clearTimeout(activityTimer);
            activityTimer = setTimeout(() => {
              // Output settled — check if there's a question prompt
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
          if (titleResetTimer) clearTimeout(titleResetTimer);
          if (activityTimer) { clearTimeout(activityTimer); activityTimer = null; }
          setTabStatus(tabId, null);
          setTitle(projectName);
          setSessionTitle(tabId, projectName);
        }
      };

      const cols = terminal.cols;
      const rows = terminal.rows;

      let spawnPromise: Promise<string>;
      if (sessionType === "shell") {
        spawnPromise = spawnShell(projectPath, cols, rows, channel);
      } else if (sessionType === "codex") {
        codexSpawnedAtMs = Date.now();
        spawnPromise = spawnCodex(projectPath, cols, rows, channel);
      } else if (sessionType === "opencode") {
        spawnPromise = spawnOpencode(projectPath, cols, rows, channel);
      } else {
        // Normal Claude tabs should not force --session-id; explicit resume/attach flows can opt in separately.
        spawnPromise = spawnSession(projectPath, cols, rows, channel);
      }

      spawnPromise
        .then((sid) => {
          if (cleanedUp || spawnGenerationRef.current !== spawnGeneration) {
            logPtyLifecycle("spawn:stale", { tabId, spawnGeneration, sid });
            killSession(sid).catch(() => {});
            return;
          }
          logPtyLifecycle("spawn:ready", { tabId, spawnGeneration, sid });
          sessionIdRef.current = sid;
          updateSessionPtyId(tabId, sid);
        })
        .catch((err) => {
          if (!cleanedUp && spawnGenerationRef.current === spawnGeneration) {
            logPtyLifecycle("spawn:error", { tabId, spawnGeneration, error: String(err) });
            const label =
              sessionType === "shell"
                ? "shell"
                : sessionType === "opencode"
                  ? "opencode session"
                  : sessionType === "codex"
                    ? "codex session"
                    : "Claude session";
            terminal.write(`\r\n\x1b[31mFailed to spawn ${label}: ${err}\x1b[0m\r\n`);
          }
        });
    });

    // User input → PTY
    // Let Ctrl+V pass through to the browser so the native paste event fires
    terminal.attachCustomKeyEventHandler((ev) => {
      if (ev.ctrlKey && !ev.shiftKey && !ev.altKey && ev.key === "v") {
        return false;
      }
      return true;
    });

    const onDataDisposable = terminal.onData((data) => {
      lastUserInputTime = Date.now();
      // Clear "waiting" status when user types
      const currentStatus = useSessionStore.getState().tabStatuses.get(tabId);
      if (currentStatus === "waiting") {
        setTabStatus(tabId, null);
      }
      if (sessionIdRef.current) {
        const encoder = new TextEncoder();
        writeSession(sessionIdRef.current, encoder.encode(data)).catch(() => {});
      }
      if (sessionType === "codex" && (data.includes("\r") || data.includes("\n"))) {
        if (codexTitleTimer) clearTimeout(codexTitleTimer);
        codexTitleTimer = setTimeout(() => {
          codexTitleTimer = null;
          refreshCodexTitle();
        }, 800);
      }
    });

    // Resize handling
    const onResizeDisposable = terminal.onResize(({ cols, rows }) => {
      if (sessionIdRef.current) {
        resizeSession(sessionIdRef.current, cols, rows).catch(() => {});
      }
    });

    // Terminal title changes
    const onTitleDisposable = terminal.onTitleChange((t) => {
      titleChangedDuringWrite = true;
      if (titleResetTimer) {
        clearTimeout(titleResetTimer);
        titleResetTimer = null;
      }
      const clean = t.replace(/^[^\x20-\x7E]+\s*/, '').trim() || t;
      setTitle(clean);
      setSessionTitle(tabId, clean);
    });

    // Copy selection to clipboard
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
      await writeSession(sid, encoder.encode(filePath));
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

    const onPaste = (ev: ClipboardEvent) => {
      ev.preventDefault();
      void handleClipboardPaste(ev);
    };
    containerEl.addEventListener("paste", onPaste);

    // ResizeObserver for container size changes
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry || entry.contentRect.width === 0 || entry.contentRect.height === 0) return;
      requestAnimationFrame(() => {
        fitAddon.fit();
      });
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      cleanedUp = true;
      logPtyLifecycle("mount:cleanup:start", { tabId, spawnGeneration });
      const ownedSessionId = sessionIdRef.current;
      const latestStoreSessionId = useSessionStore
        .getState()
        .sessions
        .find((session) => session.id === tabId)
        ?.sessionId ?? null;
      if (ownedSessionId && latestStoreSessionId && latestStoreSessionId !== ownedSessionId) {
        logPtyLifecycle("cleanup:session-mismatch", {
          tabId,
          spawnGeneration,
          ownedSessionId,
          latestStoreSessionId,
        });
      }
      sessionIdRef.current = null;
      if (titleResetTimer) clearTimeout(titleResetTimer);
      if (activityTimer) clearTimeout(activityTimer);
      if (codexTitleTimer) clearTimeout(codexTitleTimer);
      containerEl.removeEventListener("paste", onPaste);
      setTabStatus(tabId, null);
      resizeObserver.disconnect();
      onDataDisposable.dispose();
      onResizeDisposable.dispose();
      onTitleDisposable.dispose();
      onSelectionDisposable.dispose();
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      if (screenshotTimerRef.current) clearTimeout(screenshotTimerRef.current);
      if (ownedSessionId) {
        logPtyLifecycle("session:kill", { tabId, spawnGeneration, sid: ownedSessionId });
        killSession(ownedSessionId).catch(() => {});
      }
      terminal.dispose();
      initializedRef.current = false;
      logPtyLifecycle("mount:cleanup:done", { tabId, spawnGeneration });
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPath, tabId, sessionType]);

  // Re-fit and focus when this session becomes active
  useEffect(() => {
    if (activeProjectPath !== projectPath) return;
    if (activeSessionId !== tabId) return;
    const raf = requestAnimationFrame(() => {
      fitAddonRef.current?.fit();
      terminalRef.current?.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [activeProjectPath, projectPath, activeSessionId, tabId]);

  // Apply settings changes
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;

    terminal.options.fontSize = settings.terminalFontSize;
    terminal.options.fontFamily = settings.terminalFontFamily;
    terminal.options.theme = THEMES[projectTheme].xterm;
    fitAddonRef.current?.fit();
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
