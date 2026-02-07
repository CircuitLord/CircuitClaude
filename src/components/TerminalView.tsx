import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { SerializeAddon } from "@xterm/addon-serialize";
import { Channel } from "@tauri-apps/api/core";
import { spawnSession, spawnShell, spawnOpencode, spawnCodex, writeSession, resizeSession, killSession } from "../lib/pty";
import { registerTerminal, unregisterTerminal } from "../lib/terminalRegistry";
import { useSessionStore } from "../stores/sessionStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useProjectStore } from "../stores/projectStore";
import { THEMES } from "../lib/themes";
import { PtyOutputEvent, SessionType } from "../types";
import "@xterm/xterm/css/xterm.css";

interface TerminalViewProps {
  tabId: string;
  projectPath: string;
  projectName: string;
  sessionType: SessionType;
  claudeSessionId?: string;
  isRestored?: boolean;
  hideTitleBar?: boolean;
  onClose: () => void;
}

export function TerminalView({ tabId, projectPath, projectName, sessionType, claudeSessionId, isRestored, hideTitleBar, onClose }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const [title, setTitle] = useState(projectName);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const initializedRef = useRef(false);
  const updateSessionPtyId = useSessionStore((s) => s.updateSessionPtyId);
  const markInteracted = useSessionStore((s) => s.markInteracted);
  const activeProjectPath = useSessionStore((s) => s.activeProjectPath);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const settings = useSettingsStore((s) => s.settings);
  const projectTheme = useProjectStore(
    (s) => s.projects.find((p) => p.path === projectPath)?.theme ?? "midnight"
  );
  const [showCopied, setShowCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!containerRef.current || initializedRef.current) return;
    initializedRef.current = true;
    let cleanedUp = false;

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
    const serializeAddon = new SerializeAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(serializeAddon);
    terminal.loadAddon(new WebLinksAddon());
    terminal.open(containerRef.current);

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
    registerTerminal(tabId, terminal, serializeAddon);

    requestAnimationFrame(() => {
      fitAddon.fit();

      const channel = new Channel<PtyOutputEvent>();
      channel.onmessage = (event: PtyOutputEvent) => {
        if (event.type === "Data" && Array.isArray(event.data)) {
          terminal.write(new Uint8Array(event.data));
        } else if (event.type === "Exit") {
          terminal.write("\r\n\x1b[90m[Process exited]\x1b[0m\r\n");
        }
      };

      const cols = terminal.cols;
      const rows = terminal.rows;

      let spawnPromise: Promise<string>;
      if (sessionType === "shell") {
        spawnPromise = spawnShell(projectPath, cols, rows, channel);
      } else if (sessionType === "codex") {
        spawnPromise = spawnCodex(projectPath, cols, rows, channel);
      } else if (sessionType === "opencode") {
        spawnPromise = spawnOpencode(projectPath, cols, rows, channel, {
          continueSession: isRestored,
        });
      } else {
        spawnPromise = spawnSession(projectPath, cols, rows, channel, {
          claudeSessionId: claudeSessionId,
          resumeSessionId: isRestored ? claudeSessionId : undefined,
        });
      }

      spawnPromise
        .then((sid) => {
          if (cleanedUp) {
            killSession(sid).catch(() => {});
            return;
          }
          sessionIdRef.current = sid;
          updateSessionPtyId(tabId, sid);
          markInteracted(tabId);
        })
        .catch((err) => {
          if (!cleanedUp) {
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
    const onDataDisposable = terminal.onData((data) => {
      if (sessionIdRef.current) {
        const encoder = new TextEncoder();
        writeSession(sessionIdRef.current, encoder.encode(data)).catch(() => {});
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
      const clean = t.replace(/^[^\x20-\x7E]+\s*/, '').trim() || t;
      setTitle(clean);
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
      resizeObserver.disconnect();
      onDataDisposable.dispose();
      onResizeDisposable.dispose();
      onTitleDisposable.dispose();
      onSelectionDisposable.dispose();
      unregisterTerminal(tabId);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      if (sessionIdRef.current) {
        killSession(sessionIdRef.current).catch(() => {});
        sessionIdRef.current = null;
      }
      terminal.dispose();
      initializedRef.current = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPath, tabId, sessionType, claudeSessionId, isRestored]);

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
      {showCopied && (
        <div className="terminal-status-line">copied to clipboard</div>
      )}
    </div>
  );
}
