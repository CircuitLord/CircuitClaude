import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { SerializeAddon } from "@xterm/addon-serialize";
import { Channel } from "@tauri-apps/api/core";
import { spawnSession, writeSession, resizeSession, killSession } from "../lib/pty";
import { loadScrollback } from "../lib/config";
import { registerTerminal, unregisterTerminal } from "../lib/terminalRegistry";
import { useSessionStore } from "../stores/sessionStore";
import { useSettingsStore } from "../stores/settingsStore";
import { THEMES } from "../lib/themes";
import { PtyOutputEvent } from "../types";
import "@xterm/xterm/css/xterm.css";


/** Check the last few lines of the terminal buffer for interactive prompt patterns
 *  (tool approval, option selection) that indicate Claude is waiting for user action. */
function detectInteractivePrompt(terminal: Terminal): boolean {
  const buffer = terminal.buffer.active;
  const cursorLine = buffer.baseY + buffer.cursorY;
  const lines: string[] = [];
  for (let i = Math.max(0, cursorLine - 8); i <= cursorLine; i++) {
    const line = buffer.getLine(i);
    if (line) lines.push(line.translateToString());
  }
  const text = lines.join("\n");

  // DEBUG: log what we're checking so we can see false positives
  console.log("[prompt-detect] cursor:", cursorLine, "text:", JSON.stringify(text));

  // Tool approval prompt (shows "Chat about this" as an option alongside Yes/No/Always)
  if (/Chat about this/.test(text)) { console.log("[prompt-detect] matched: Chat about this"); return true; }

  return false;
}

interface TerminalViewProps {
  tabId: string;
  projectPath: string;
  projectName: string;
  claudeSessionId?: string;
  isRestored?: boolean;
  hideTitleBar?: boolean;
  onClose: () => void;
}

export function TerminalView({ tabId, projectPath, projectName, claudeSessionId, isRestored, hideTitleBar, onClose }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const [title, setTitle] = useState(projectName);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const initializedRef = useRef(false);
  const isRestoredRef = useRef(isRestored);
  const updateSessionPtyId = useSessionStore((s) => s.updateSessionPtyId);
  const clearRestoredFlag = useSessionStore((s) => s.clearRestoredFlag);
  const setThinking = useSessionStore((s) => s.setThinking);
  const setNeedsAttention = useSessionStore((s) => s.setNeedsAttention);
  const setSessionTitle = useSessionStore((s) => s.setSessionTitle);
  const markInteracted = useSessionStore((s) => s.markInteracted);
  const confirmRestore = useSessionStore((s) => s.confirmRestore);
  const activeProjectPath = useSessionStore((s) => s.activeProjectPath);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const settings = useSettingsStore((s) => s.settings);
  const thinkingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastInputTimeRef = useRef<number>(0);
  const hasInteractedRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current || initializedRef.current) return;
    initializedRef.current = true;
    let cleanedUp = false;
    let restoreTimer: ReturnType<typeof setTimeout> | null = null;

    const currentSettings = useSettingsStore.getState().settings;
    const terminal = new Terminal({
      cursorBlink: currentSettings.terminalCursorBlink,
      cursorStyle: currentSettings.terminalCursorStyle,
      fontSize: currentSettings.terminalFontSize,
      fontFamily: currentSettings.terminalFontFamily,
      theme: THEMES[currentSettings.theme].xterm,
    });

    const fitAddon = new FitAddon();
    const serializeAddon = new SerializeAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(serializeAddon);
    terminal.loadAddon(new WebLinksAddon());
    terminal.open(containerRef.current);

    // Load WebGL renderer for proper block/box character rendering (customGlyphs)
    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => {
        webglAddon.dispose();
      });
      terminal.loadAddon(webglAddon);
    } catch {
      console.warn("WebGL renderer not available, falling back to DOM renderer");
    }

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    registerTerminal(tabId, terminal, serializeAddon);

    // Fit terminal then restore scrollback (if restored) then spawn PTY
    requestAnimationFrame(() => {
      fitAddon.fit();

      const doSpawn = () => {
        console.log("[TerminalView]", tabId, "doSpawn isRestored:", isRestoredRef.current, "claudeSessionId:", claudeSessionId);
        const channel = new Channel<PtyOutputEvent>();
        channel.onmessage = (event: PtyOutputEvent) => {
          if (event.type === "Data" && Array.isArray(event.data)) {
            terminal.write(new Uint8Array(event.data));

            // Only show thinking after the user has interacted at least once,
            // and not for output that's likely a keystroke echo (arrives <250ms after input)
            const isEcho = (Date.now() - lastInputTimeRef.current) < 250;
            if (hasInteractedRef.current && !isEcho) {
              setThinking(tabId, true);
              setNeedsAttention(tabId, false);
            }
            if (thinkingTimerRef.current) clearTimeout(thinkingTimerRef.current);
            thinkingTimerRef.current = setTimeout(() => {
              setThinking(tabId, false);
              if (detectInteractivePrompt(terminal)) {
                setNeedsAttention(tabId, true);
              }
            }, 2000);
          } else if (event.type === "Exit") {
            console.log("[TerminalView]", tabId, "Exit event. isRestored:", isRestoredRef.current, "hasInteracted:", hasInteractedRef.current);
            if (thinkingTimerRef.current) clearTimeout(thinkingTimerRef.current);
            setThinking(tabId, false);
            setNeedsAttention(tabId, false);
            if (isRestoredRef.current && !hasInteractedRef.current) {
              // Restored session exited before user interacted (e.g. invalid session ID) — close silently
              console.log("[TerminalView]", tabId, "→ closing silently (restored + no interaction)");
              onClose();
            } else {
              console.log("[TerminalView]", tabId, "→ showing [Process exited] message");
              terminal.write("\r\n\x1b[90m[Process exited]\x1b[0m\r\n");
            }
          }
        };

        const cols = terminal.cols;
        const rows = terminal.rows;
        spawnSession(projectPath, cols, rows, channel,
            isRestoredRef.current
              ? claudeSessionId
                ? { resumeSessionId: claudeSessionId }   // Restored with known ID → --resume <uuid>
                : { continueSession: true }               // Legacy restored (no ID) → --continue
              : { claudeSessionId }                       // New session → --session-id <uuid>
          )
          .then((sid) => {
            if (cleanedUp) {
              // Strict mode re-mount: this effect was cleaned up, kill the orphaned PTY
              killSession(sid).catch(() => {});
              return;
            }
            console.log("[TerminalView]", tabId, "spawn succeeded, ptyId:", sid);
            sessionIdRef.current = sid;
            updateSessionPtyId(tabId, sid);
            clearRestoredFlag(tabId);
            if (isRestoredRef.current) {
              // Fallback: confirm after 15s if title change never fires
              restoreTimer = setTimeout(() => {
                console.log("[TerminalView]", tabId, "confirmRestore (fallback timer)");
                confirmRestore(tabId);
              }, 15000);
            }
          })
          .catch((err) => {
            if (cleanedUp) return;
            console.log("[TerminalView]", tabId, "spawn FAILED:", String(err), "isRestored:", isRestoredRef.current);
            const errStr = String(err);
            if (isRestoredRef.current || /session.*already|already.*in use|no conversation found/i.test(errStr)) {
              // Stale/invalid session or ID conflict — remove the terminal silently
              onClose();
            } else {
              terminal.write(`\r\n\x1b[31mFailed to spawn session: ${err}\x1b[0m\r\n`);
            }
          });
      };

      if (isRestoredRef.current) {
        loadScrollback(tabId)
          .then((data) => {
            terminal.write(data);
            terminal.write("\r\n\x1b[90m--- Session restored ---\x1b[0m\r\n\r\n");
          })
          .catch(() => {
            // No scrollback file — that's fine
          })
          .finally(doSpawn);
      } else {
        doSpawn();
      }
    });

    // User input → PTY
    const onDataDisposable = terminal.onData((data) => {
      if (sessionIdRef.current) {
        if (!hasInteractedRef.current) markInteracted(tabId);
        hasInteractedRef.current = true;
        lastInputTimeRef.current = Date.now();
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

    // Capture terminal title changes (OSC 2 sequences from Claude CLI)
    // Strip leading non-ASCII decorative characters (spinner/star icons) from the title
    // A title change is the definitive signal that Claude CLI is alive and interactive.
    const onTitleDisposable = terminal.onTitleChange((t) => {
      const clean = t.replace(/^[^\x20-\x7E]+\s*/, '').trim() || t;
      setTitle(clean);
      setSessionTitle(tabId, clean);
      // Confirm restored session as soon as Claude CLI sets a title
      if (isRestoredRef.current && restoreTimer) {
        console.log("[TerminalView]", tabId, "confirmRestore (title change)");
        clearTimeout(restoreTimer);
        restoreTimer = null;
        confirmRestore(tabId);
      }
    });

    // ResizeObserver for container size changes — skip fit when hidden (zero dimensions)
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
      unregisterTerminal(tabId);
      if (thinkingTimerRef.current) clearTimeout(thinkingTimerRef.current);
      if (restoreTimer) clearTimeout(restoreTimer);
      setThinking(tabId, false);
      setNeedsAttention(tabId, false);
      // Kill PTY on unmount — this only happens when the session is actually removed,
      // not on project switch (which uses display:none instead of unmounting)
      if (sessionIdRef.current) {
        killSession(sessionIdRef.current).catch(() => {});
        sessionIdRef.current = null;
      }
      terminal.dispose();
      initializedRef.current = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPath, tabId, claudeSessionId]);

  // Re-fit and focus terminal when this session becomes active (tab switch or new spawn)
  useEffect(() => {
    if (activeProjectPath !== projectPath) return;
    if (activeSessionId !== tabId) return;
    // Small delay to let the browser paint the now-visible container
    const raf = requestAnimationFrame(() => {
      fitAddonRef.current?.fit();
      terminalRef.current?.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [activeProjectPath, projectPath, activeSessionId, tabId]);

  // Apply settings changes to live terminals
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;

    terminal.options.fontSize = settings.terminalFontSize;
    terminal.options.fontFamily = settings.terminalFontFamily;
    terminal.options.cursorBlink = settings.terminalCursorBlink;
    terminal.options.cursorStyle = settings.terminalCursorStyle;
    terminal.options.theme = THEMES[settings.theme].xterm;
    fitAddonRef.current?.fit();
  }, [settings.terminalFontSize, settings.terminalFontFamily, settings.terminalCursorBlink, settings.terminalCursorStyle, settings.theme]);

  return (
    <div className="terminal-view">
      {!hideTitleBar && (
        <div className="terminal-title-bar">
          <span className="terminal-title-text" title={title}>{title}</span>
          <button className="terminal-title-close" onClick={onClose} title="Close session">x</button>
        </div>
      )}
      <div className="terminal-container" ref={containerRef} />
    </div>
  );
}
