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
import { PtyOutputEvent } from "../types";
import "@xterm/xterm/css/xterm.css";

function CloseIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    >
      <path d="M3 3L9 9M9 3L3 9" />
    </svg>
  );
}

interface TerminalViewProps {
  tabId: string;
  projectPath: string;
  projectName: string;
  isRestored?: boolean;
  onClose: () => void;
}

export function TerminalView({ tabId, projectPath, projectName, isRestored, onClose }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const [title, setTitle] = useState(projectName);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const initializedRef = useRef(false);
  const updateSessionPtyId = useSessionStore((s) => s.updateSessionPtyId);
  const clearRestoredFlag = useSessionStore((s) => s.clearRestoredFlag);
  const activeProjectPath = useSessionStore((s) => s.activeProjectPath);

  useEffect(() => {
    if (!containerRef.current || initializedRef.current) return;
    initializedRef.current = true;

    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: "bar",
      fontSize: 14,
      fontFamily: "'Cascadia Code', 'Consolas', 'Monaco', monospace",
      theme: {
        background: "#09090f",
        foreground: "#e2e2e8",
        cursor: "#7c3aed",
        cursorAccent: "#09090f",
        selectionBackground: "rgba(124, 58, 237, 0.25)",
        selectionForeground: "#e2e2e8",
        black: "#09090f",
        brightBlack: "#4a4a56",
        white: "#e2e2e8",
        brightWhite: "#ffffff",
      },
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
        spawnSession(projectPath, cols, rows, channel, !!isRestored)
          .then((sid) => {
            sessionIdRef.current = sid;
            updateSessionPtyId(tabId, sid);
            clearRestoredFlag(tabId);
          })
          .catch((err) => {
            terminal.write(`\r\n\x1b[31mFailed to spawn session: ${err}\x1b[0m\r\n`);
          });
      };

      if (isRestored) {
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
    const onTitleDisposable = terminal.onTitleChange(setTitle);

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
      resizeObserver.disconnect();
      onDataDisposable.dispose();
      onResizeDisposable.dispose();
      onTitleDisposable.dispose();
      unregisterTerminal(tabId);
      // Kill PTY on unmount — this only happens when the session is actually removed,
      // not on project switch (which uses display:none instead of unmounting)
      if (sessionIdRef.current) {
        killSession(sessionIdRef.current).catch(() => {});
        sessionIdRef.current = null;
      }
      terminal.dispose();
      initializedRef.current = false;
    };
  }, [projectPath, tabId, isRestored, updateSessionPtyId, clearRestoredFlag]);

  // Re-fit terminal when this project becomes the active one (switching from display:none to display:flex)
  useEffect(() => {
    if (activeProjectPath !== projectPath) return;
    // Small delay to let the browser paint the now-visible container
    const raf = requestAnimationFrame(() => {
      fitAddonRef.current?.fit();
    });
    return () => cancelAnimationFrame(raf);
  }, [activeProjectPath, projectPath]);

  return (
    <div className="terminal-view">
      <div className="terminal-title-bar">
        <span className="terminal-title-text" title={title}>{title}</span>
        <button className="terminal-title-close" onClick={onClose} title="Close session">
          <CloseIcon />
        </button>
      </div>
      <div className="terminal-container" ref={containerRef} />
    </div>
  );
}
