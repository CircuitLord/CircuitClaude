import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSessionStore } from "../stores/sessionStore";
import { useSessionDragStore } from "../stores/sessionDragStore";
import { useEditorStore } from "../stores/editorStore";
import { TerminalView } from "./TerminalView";
import { EditorViewComponent } from "./EditorView";
import { PiChatView } from "./PiChatView";
import { closeTab } from "../lib/sessions";
import { getTabPrefix } from "../lib/sessionTypes";

interface TerminalTabsProps {
  projectPath: string;
}

export function TerminalTabs({ projectPath }: TerminalTabsProps) {
  const {
    sessions,
    activeSessionId,
    projectSplits,
    clearSplit,
    setFocusedPane,
  } = useSessionStore();

  // Subscribe to editor files so the header re-renders on readOnly toggle
  const editorFiles = useEditorStore((s) => s.files);

  const dragSessionId = useSessionDragStore((s) => s.sessionId);
  const dragProjectPath = useSessionDragStore((s) => s.projectPath);
  const dragZone = useSessionDragStore((s) => s.zone);
  const dragPane = useSessionDragStore((s) => s.pane);
  const dragActive = dragSessionId !== null && dragProjectPath === projectPath;

  const panelsRef = useRef<HTMLDivElement>(null);

  const [splitRatio, setSplitRatio] = useState(50);
  const resizingRef = useRef(false);

  const split = projectSplits.get(projectPath) ?? null;

  const projectSessions = sessions.filter((s) => s.projectPath === projectPath);
  const visibleSessionIds = useMemo(() => projectSessions.map((s) => s.id), [projectSessions]);

  // When unsplit, manage mounted sessions for xterm persistence
  const [mountedSessionIds, setMountedSessionIds] = useState<string[]>(visibleSessionIds);
  // When split, each pane tracks its own mounted sessions
  const [pane1MountedIds, setPane1MountedIds] = useState<string[]>([]);
  const [pane2MountedIds, setPane2MountedIds] = useState<string[]>([]);

  // Reset split ratio when entering split mode
  const prevSplitRef = useRef(split);
  useEffect(() => {
    if (split && !prevSplitRef.current) {
      setSplitRatio(50);
    }
    prevSplitRef.current = split;
  }, [split]);

  useEffect(() => {
    if (split) return; // Skip when split — pane-specific tracking handles it
    setMountedSessionIds((prev) => syncMounted(prev, visibleSessionIds));
  }, [visibleSessionIds, split]);

  useEffect(() => {
    if (!split) return;
    setPane1MountedIds((prev) => syncMounted(prev, split.pane1.sessionIds));
    setPane2MountedIds((prev) => syncMounted(prev, split.pane2.sessionIds));
  }, [split]);

  function syncMounted(prev: string[], current: string[]): string[] {
    const currentSet = new Set(current);
    const next: string[] = [];
    for (const id of prev) {
      if (currentSet.has(id)) next.push(id);
    }
    const nextSet = new Set(next);
    for (const id of current) {
      if (!nextSet.has(id)) {
        next.push(id);
        nextSet.add(id);
      }
    }
    if (next.length === prev.length && next.every((id, idx) => id === prev[idx])) {
      return prev;
    }
    return next;
  }

  const sessionById = useMemo(
    () => new Map(projectSessions.map((session) => [session.id, session])),
    [projectSessions]
  );

  const activeInProject = projectSessions.find((s) => s.id === activeSessionId);
  const visibleSessionId = activeInProject?.id ?? projectSessions[0]?.id ?? null;

  // --- Pane header ---
  function computeBreadcrumb(filePath: string): string[] {
    const norm = filePath.replace(/\\/g, "/");
    const normProject = projectPath.replace(/\\/g, "/");

    // File inside project → relative path
    if (norm.startsWith(normProject + "/")) {
      return norm.slice(normProject.length + 1).split("/");
    }

    // File in user home → abbreviate with ~
    const homeMatch = norm.match(/^[A-Za-z]:\/Users\/[^/]+(\/.*)/);
    if (homeMatch) {
      return ["~", ...homeMatch[1].slice(1).split("/")];
    }

    return norm.split("/").filter(Boolean);
  }

  function renderPaneHeader(sessionId: string | null) {
    if (!sessionId) return null;
    const session = sessionById.get(sessionId);
    if (!session) return null;
    const prefix = getTabPrefix(session.sessionType);

    if (session.sessionType === "editor" && session.filePath) {
      const segments = computeBreadcrumb(session.filePath);
      const isReadOnly = editorFiles.get(sessionId)?.readOnly ?? true;
      return (
        <div className="pane-header">
          <span className="pane-header-prefix">{prefix}</span>
          {segments.map((seg, i) => (
            <span key={i} className="pane-header-crumb">
              {i > 0 && <span className="editor-breadcrumb-sep">&gt;</span>}
              <span className="editor-breadcrumb-segment">{seg}</span>
            </span>
          ))}
          <span
            className={`editor-mode-toggle${!isReadOnly ? " editor-mode-toggle--edit" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              useEditorStore.getState().setReadOnly(sessionId, !isReadOnly);
            }}
          >
            {isReadOnly ? ":view" : ":edit"}
          </span>
        </div>
      );
    }

    // terminals run headerless — the tab strip already names them
    return null;
  }

  // --- Resize handle ---
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    if (!split) return;
    // We need the split container element, which is the parent of the resize handle
    const containerEl = (e.currentTarget as HTMLElement).parentElement;
    if (!containerEl) return;
    e.preventDefault();
    resizingRef.current = true;
    const rect = containerEl.getBoundingClientRect();

    const onMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return;
      let ratio: number;
      if (split.direction === "horizontal") {
        ratio = ((ev.clientX - rect.left) / rect.width) * 100;
      } else {
        ratio = ((ev.clientY - rect.top) / rect.height) * 100;
      }
      ratio = Math.max(10, Math.min(90, ratio));
      if (ratio <= 10 || ratio >= 90) {
        resizingRef.current = false;
        document.body.style.cursor = "";
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        clearSplit(projectPath);
        return;
      }
      setSplitRatio(ratio);
    };

    const onUp = () => {
      resizingRef.current = false;
      document.body.style.cursor = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    document.body.style.cursor = split.direction === "horizontal" ? "col-resize" : "row-resize";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [split, projectPath, clearSplit]);

  const handleResizeDoubleClick = useCallback(() => {
    clearSplit(projectPath);
  }, [projectPath, clearSplit]);

  // --- Panel rendering helper ---
  function renderPanel(
    sessionId: string,
    visible: boolean,
    onPaneClick?: () => void,
    isFocusedPane?: boolean,
  ) {
    const session = sessionById.get(sessionId);
    if (!session || session.isDormant) return null;
    return (
      <div
        key={session.id}
        className={`terminal-tabs-panel${session.sessionType === "pi-chat" ? " terminal-tabs-panel--pi-chat" : ""}${isFocusedPane !== undefined ? " terminal-tabs-panel--pane" : ""}${isFocusedPane ? " terminal-tabs-panel--focused" : ""}`}
        style={{ display: visible ? "flex" : "none" }}
        data-active={visible ? "true" : undefined}
        onMouseDown={onPaneClick}
      >
        {session.sessionType === "editor" && session.filePath ? (
          <EditorViewComponent
            tabId={session.id}
            filePath={session.filePath}
            fileName={session.fileName ?? "file"}
          />
        ) : session.sessionType === "pi-chat" ? (
          <PiChatView
            tabId={session.id}
            projectPath={session.projectPath}
            agentSessionId={session.agentSessionId!}
          />
        ) : (
          <TerminalView
            tabId={session.id}
            projectPath={session.projectPath}
            projectName={session.projectName}
            sessionType={session.sessionType}
            agentSessionId={session.agentSessionId}
            resumeSession={session.resumeSession}
            hideTitleBar
            onClose={() => closeTab(session.id)}
          />
        )}
      </div>
    );
  }

  if (projectSessions.length === 0) return null;

  // ===== SPLIT MODE =====
  if (split) {
    const pane1 = split.pane1;
    const pane2 = split.pane2;
    const isHorizontal = split.direction === "horizontal";

    const renderPane = (paneNum: 1 | 2) => {
      const pane = paneNum === 1 ? pane1 : pane2;
      const mounted = paneNum === 1 ? pane1MountedIds : pane2MountedIds;
      const size = paneNum === 1 ? splitRatio : 100 - splitRatio;
      return (
        <div
          className={`terminal-tabs-pane${split.focusedPane === paneNum ? " terminal-tabs-pane--focused" : ""}${dragActive && dragPane === paneNum ? " terminal-tabs-pane--drop-target" : ""}`}
          style={isHorizontal ? { width: `calc(${size}% - 1px)` } : { height: `calc(${size}% - 1px)` }}
          data-pane={paneNum}
          onMouseDown={() => setFocusedPane(projectPath, paneNum)}
        >
          {renderPaneHeader(pane.activeSessionId)}
          <div className="terminal-tabs-panels">
            {mounted.map((id) =>
              renderPanel(
                id,
                id === pane.activeSessionId,
                () => setFocusedPane(projectPath, paneNum),
                split.focusedPane === paneNum,
              )
            )}
          </div>
        </div>
      );
    };

    return (
      <div className="terminal-tabs-container">
        <div
          className={`terminal-tabs-split-container terminal-tabs-split-container--${isHorizontal ? "h" : "v"}`}
          ref={panelsRef}
        >
          {renderPane(1)}
          <div
            className={`split-resize-handle split-resize-handle--${isHorizontal ? "h" : "v"}`}
            onMouseDown={handleResizeStart}
            onDoubleClick={handleResizeDoubleClick}
          />
          {renderPane(2)}
        </div>
      </div>
    );
  }

  // ===== UNSPLIT MODE =====
  return (
    <div className="terminal-tabs-container">
      {renderPaneHeader(visibleSessionId)}
      <div className="terminal-tabs-panels" ref={panelsRef}>
        {/* Drop zone overlay while a sidebar session is dragged over the terminal */}
        {dragActive && (
          <div className="split-drop-overlay">
            <div className={`split-drop-zone split-drop-zone--left${dragZone === "left" ? " split-drop-zone--active" : ""}`}>
              <span className="split-drop-label">| split</span>
            </div>
            <div className={`split-drop-zone split-drop-zone--right${dragZone === "right" ? " split-drop-zone--active" : ""}`}>
              <span className="split-drop-label">split |</span>
            </div>
            <div className={`split-drop-zone split-drop-zone--top${dragZone === "top" ? " split-drop-zone--active" : ""}`}>
              <span className="split-drop-label">&mdash; split</span>
            </div>
            <div className={`split-drop-zone split-drop-zone--bottom${dragZone === "bottom" ? " split-drop-zone--active" : ""}`}>
              <span className="split-drop-label">split &mdash;</span>
            </div>
          </div>
        )}
        {mountedSessionIds.map((id) => renderPanel(id, id === visibleSessionId))}
      </div>
    </div>
  );
}
