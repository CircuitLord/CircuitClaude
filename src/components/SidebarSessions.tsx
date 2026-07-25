import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useSessionStore, findPane } from "../stores/sessionStore";
import { useSessionDragStore } from "../stores/sessionDragStore";
import type { DropZone } from "../stores/sessionDragStore";
import { useEditorStore } from "../stores/editorStore";
import { useProjectStore } from "../stores/projectStore";
import { archiveTab, pinTab } from "../lib/sessions";
import { getSessionDisplayName } from "../lib/sessionTypes";
import { formatAge } from "../lib/time";
import { THEMES } from "../lib/themes";
import type { SplitDirection, PaneState } from "../types";

function paneAreaFor(projectPath: string, pane: 1 | 2): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `.terminal-grid-wrapper[data-project="${CSS.escape(projectPath)}"] .terminal-tabs-pane[data-pane="${pane}"]`
  );
}

function panelsAreaFor(projectPath: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `.terminal-grid-wrapper[data-project="${CSS.escape(projectPath)}"] .terminal-tabs-panels`
  );
}

function contains(el: HTMLElement | null, x: number, y: number): boolean {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

function computeDropZone(el: HTMLElement, x: number, y: number): DropZone {
  const rect = el.getBoundingClientRect();
  const relX = (x - rect.left) / rect.width;
  const relY = (y - rect.top) / rect.height;
  if (relX < 0.2) return "left";
  if (relX > 0.8) return "right";
  if (relY < 0.25) return "top";
  if (relY > 0.75) return "bottom";
  return null;
}

export function SidebarSessions() {
  const sessions = useSessionStore((s) => s.sessions);
  const archivedSessions = useSessionStore((s) => s.archivedSessions);
  const restoreSession = useSessionStore((s) => s.restoreSession);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const tabStatuses = useSessionStore((s) => s.tabStatuses);
  const sessionTitles = useSessionStore((s) => s.sessionTitles);
  const lastActivity = useSessionStore((s) => s.lastActivity);
  const projectSplits = useSessionStore((s) => s.projectSplits);
  const activateSession = useSessionStore((s) => s.activateSession);
  const projects = useProjectStore((s) => s.projects);
  // subscribe so dirty markers refresh
  const editorFiles = useEditorStore((s) => s.files);

  const [archiveOpen, setArchiveOpen] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const dropIndexRef = useRef<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // re-render so the "x ago" stamps stay honest
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(timer);
  }, []);

  const handleDragStart = useCallback((e: React.MouseEvent, index: number) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest(".sidebar-session-close")) return;
    e.preventDefault();
    e.stopPropagation();

    const dragged = useSessionStore.getState().sessions[index];
    if (!dragged) return;
    const projectPath = dragged.projectPath;

    setDragIndex(index);
    document.body.style.cursor = "grabbing";

    const drag = useSessionDragStore.getState();
    let overTerminal = false;

    const onMove = (ev: MouseEvent) => {
      const state = useSessionStore.getState();
      const latestSplit = state.projectSplits.get(projectPath) ?? null;
      const projectSessionCount = state.sessions.filter((s) => s.projectPath === projectPath).length;

      // dropping onto the terminal area only makes sense for the visible project
      if (state.activeProjectPath === projectPath) {
        if (latestSplit) {
          const draggedPane = findPane(latestSplit, dragged.id);
          const targetPane = contains(paneAreaFor(projectPath, 1), ev.clientX, ev.clientY)
            ? 1
            : contains(paneAreaFor(projectPath, 2), ev.clientX, ev.clientY)
              ? 2
              : null;
          if (targetPane && targetPane !== draggedPane) {
            if (!overTerminal) {
              overTerminal = true;
              drag.start(dragged.id, projectPath);
              setDragIndex(null);
              setDropIndex(null);
              dropIndexRef.current = null;
            }
            drag.setTarget(null, targetPane);
            return;
          }
        } else if (projectSessionCount >= 2) {
          const panels = panelsAreaFor(projectPath);
          if (contains(panels, ev.clientX, ev.clientY)) {
            if (!overTerminal) {
              overTerminal = true;
              drag.start(dragged.id, projectPath);
              setDragIndex(null);
              setDropIndex(null);
              dropIndexRef.current = null;
            }
            drag.setTarget(computeDropZone(panels!, ev.clientX, ev.clientY), null);
            return;
          }
        }
      }

      if (overTerminal) {
        overTerminal = false;
        useSessionDragStore.getState().end();
        setDragIndex(index);
      }

      if (!listRef.current) return;
      const entries = listRef.current.querySelectorAll<HTMLElement>(".sidebar-session");
      let newDrop = entries.length;
      for (let i = 0; i < entries.length; i++) {
        const rect = entries[i].getBoundingClientRect();
        if (ev.clientY < rect.top + rect.height / 2) {
          newDrop = i;
          break;
        }
      }
      dropIndexRef.current = newDrop;
      setDropIndex(newDrop);
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";

      const store = useSessionStore.getState();

      if (overTerminal) {
        const { zone, pane } = useSessionDragStore.getState();
        useSessionDragStore.getState().end();

        if (pane) {
          store.moveSessionToPane(projectPath, dragged.id, pane);
        } else if (zone) {
          const direction: SplitDirection = zone === "left" || zone === "right" ? "horizontal" : "vertical";
          const draggedGoesFirst = zone === "left" || zone === "top";
          const allIds = store.sessions.filter((s) => s.projectPath === projectPath).map((s) => s.id);
          const remainingIds = allIds.filter((id) => id !== dragged.id);
          if (remainingIds.length > 0) {
            const remainingActiveId = remainingIds.includes(store.activeSessionId ?? "")
              ? store.activeSessionId!
              : remainingIds[0];
            const draggedPane: PaneState = { sessionIds: [dragged.id], activeSessionId: dragged.id };
            const remainingPane: PaneState = { sessionIds: remainingIds, activeSessionId: remainingActiveId };
            store.setSplit(projectPath, {
              direction,
              pane1: draggedGoesFirst ? draggedPane : remainingPane,
              pane2: draggedGoesFirst ? remainingPane : draggedPane,
              focusedPane: draggedGoesFirst ? 1 : 2,
            });
          }
        }
      } else if (dropIndexRef.current !== null) {
        let target = dropIndexRef.current;
        if (target > index) target--;
        store.moveSession(index, target);
      }

      setDragIndex(null);
      setDropIndex(null);
      dropIndexRef.current = null;
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  return (
    <div className="sidebar-list" ref={listRef}>
      {sessions.length === 0 && <div className="sidebar-sessions-empty">no sessions yet</div>}
      {sessions.map((s, index) => {
        const isEditor = s.sessionType === "editor";
        const isActive = s.id === activeSessionId;
        const isPreview = s.isPreview === true;
        const status = isEditor ? null : tabStatuses.get(s.id) ?? null;
        const editorFile = editorFiles.get(s.id);
        const dirty = isEditor && !!editorFile && editorFile.content !== editorFile.savedContent;
        const label = isEditor ? s.fileName ?? "file" : sessionTitles.get(s.id) ?? s.projectName;
        const project = projects.find((p) => p.path === s.projectPath);
        const split = projectSplits.get(s.projectPath);
        const pane = split ? findPane(split, s.id) : null;
        const kind = isEditor ? "file" : getSessionDisplayName(s.sessionType);
        const theme = THEMES[project?.theme ?? "midnight"] ?? THEMES.midnight;
        const style: CSSProperties = {
          "--sidebar-project-accent": theme.css["--accent"],
          "--sidebar-project-accent-text": theme.css["--accent-text"],
          "--sidebar-project-text-tertiary": theme.css["--text-tertiary"],
        } as CSSProperties;

        let dropClass = "";
        if (dragIndex !== null && dropIndex !== null && dropIndex !== dragIndex && dropIndex !== dragIndex + 1) {
          if (dropIndex === index) dropClass = "drop-before";
          else if (dropIndex === sessions.length && index === sessions.length - 1) dropClass = "drop-after";
        }

        const classes = [
          "sidebar-session",
          isActive && "active",
          isPreview && "preview",
          status === "thinking" && "thinking",
          dragIndex === index && "dragging",
          dropClass,
        ].filter(Boolean).join(" ");

        return (
          <div
            key={s.id}
            className={classes}
            style={style}
            role="tab"
            aria-selected={isActive}
            tabIndex={0}
            title={label}
            onClick={(e) => { e.stopPropagation(); activateSession(s.id); }}
            onDoubleClick={() => { if (isPreview) pinTab(s.id); }}
            onMouseDown={(e) => handleDragStart(e, index)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                activateSession(s.id);
              }
            }}
          >
            <div className="sidebar-session-meta">
              <span className="sidebar-session-project">~/{project?.name ?? s.projectName}</span>
              <span className="sidebar-session-age">{formatAge(lastActivity.get(s.id) ?? s.createdAt)}</span>
            </div>
            <div className="sidebar-session-main">
              <span className="sidebar-session-name">
                {Array.from(label).map((ch, i, chars) => (
                  <span
                    key={i}
                    className="shimmer-char"
                    style={{ animationDelay: `${chars.length > 1 ? (i / (chars.length - 1)) * 4 : 0}s` }}
                  >
                    {ch}
                  </span>
                ))}
              </span>
            </div>
            <div className="sidebar-session-sub">
              <span className="sidebar-session-kind">{kind}</span>
              {dirty ? (
                <span className="sidebar-session-status dirty">unsaved</span>
              ) : status === "thinking" ? (
                <span className="sidebar-session-status thinking">thinking</span>
              ) : status === "waiting" ? (
                <span className="sidebar-session-status waiting">waiting</span>
              ) : null}
              <span className="sidebar-session-trailing">
                {pane && <span className="sidebar-session-pane">[{pane}]</span>}
                <button
                  type="button"
                  className="sidebar-session-close"
                  aria-label={isEditor ? `Close ${label}` : `Archive ${label}`}
                  title={isEditor ? "Close" : "Archive"}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); archiveTab(s.id); }}
                >
                  x
                </button>
              </span>
            </div>
          </div>
        );
      })}

      {archivedSessions.length > 0 && (
        <>
          <div className="sidebar-divider" />
          <button className="sidebar-archive-header" onClick={() => setArchiveOpen((v) => !v)}>
            <span className="sidebar-archive-caret">{archiveOpen ? "v" : ">"}</span>
            <span className="sidebar-archive-label">~/archive</span>
            <span className="sidebar-archive-count">[{archivedSessions.length}]</span>
          </button>
          {archiveOpen && archivedSessions.map((s) => {
            const label = sessionTitles.get(s.id) ?? s.projectName;
            return (
              <div
                key={s.id}
                className="sidebar-archived"
                role="button"
                tabIndex={0}
                title={`${label} — click to restore`}
                onClick={() => restoreSession(s.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    restoreSession(s.id);
                  }
                }}
              >
                <span className="sidebar-archived-name">{label}</span>
                <span className="sidebar-archived-age">{formatAge(lastActivity.get(s.id) ?? s.createdAt)}</span>
                <span className="sidebar-archived-undo">undo</span>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
