import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Channel } from "@tauri-apps/api/core";
import { spawnSession, writeSession, resizeSession, killSession } from "../lib/pty";
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
  onClose: () => void;
}

export function TerminalView({ tabId, projectPath, onClose }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const initializedRef = useRef(false);
  const updateSessionPtyId = useSessionStore((s) => s.updateSessionPtyId);

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
    terminal.loadAddon(fitAddon);
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

    // Fit terminal then spawn PTY with correct dimensions
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
      spawnSession(projectPath, cols, rows, channel)
        .then((sid) => {
          sessionIdRef.current = sid;
          updateSessionPtyId(tabId, sid);
        })
        .catch((err) => {
          terminal.write(`\r\n\x1b[31mFailed to spawn session: ${err}\x1b[0m\r\n`);
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

    // ResizeObserver for container size changes
    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        fitAddon.fit();
      });
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      onDataDisposable.dispose();
      onResizeDisposable.dispose();
      if (sessionIdRef.current) {
        killSession(sessionIdRef.current).catch(() => {});
        sessionIdRef.current = null;
      }
      terminal.dispose();
      initializedRef.current = false;
    };
  }, [projectPath, tabId, updateSessionPtyId]);

  return (
    <div className="terminal-view">
      <button
        className="terminal-close"
        onClick={onClose}
        title="Close session"
      >
        <CloseIcon />
      </button>
      <div className="terminal-container" ref={containerRef} />
    </div>
  );
}
