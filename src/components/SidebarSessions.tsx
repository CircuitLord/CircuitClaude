import { useCallback, useRef, useState } from "react";
import { useSessionStore } from "../stores/sessionStore";
import { useSessionDragStore } from "../stores/sessionDragStore";
import type { DropZone } from "../stores/sessionDragStore";
import { useEditorStore } from "../stores/editorStore";
import { closeTab, pinTab } from "../lib/sessions";
import { getTabPrefix } from "../lib/sessionTypes";
import type { SplitDirection, PaneState } from "../types";

interface SidebarSessionsProps {
  projectPath: string;
}

interface SessionRow {
  id: string;
  pane: 1 | 2 | null;
}

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

export function SidebarSessions({ projectPath }: SidebarSessionsProps) {
  const sessions = useSessionStore((s) => s.sessions);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const activeProjectPath = useSessionStore((s) => s.activeProjectPath);
  const tabStatuses = useSessionStore((s) => s.tabStatuses);
  const sessionTitles = useSessionStore((s) => s.sessionTitles);
  const projectSplits = useSessionStore((s) => s.projectSplits);
  const activateSession = useSessionStore((s) => s.activateSession);
  // subscribe so dirty markers refresh
  const editorFiles = useEditorStore((s) => s.files);

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const dropIndexRef = useRef<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const split = projectSplits.get(projectPath) ?? null;
  const projectSessions = sessions.filter((s) => s.projectPath === projectPath);
  const sessionById = new Map(projectSessions.map((s) => [s.id, s]));

  const rows: SessionRow[] = split
    ? [
        ...split.pane1.sessionIds.map((id) => ({ id, pane: 1 as const })),
        ...split.pane2.sessionIds.map((id) => ({ id, pane: 2 as const })),
      ]
    : projectSessions.map((s) => ({ id: s.id, pane: null }));

  const handleDragStart = useCallback((e: React.MouseEvent, index: number) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest(".sidebar-session-close")) return;
    e.preventDefault();
    e.stopPropagation();

    const state = useSessionStore.getState();
    const currentSplit = state.projectSplits.get(projectPath) ?? null;
    const currentRows: SessionRow[] = currentSplit
      ? [
          ...currentSplit.pane1.sessionIds.map((id) => ({ id, pane: 1 as const })),
          ...currentSplit.pane2.sessionIds.map((id) => ({ id, pane: 2 as const })),
        ]
      : state.sessions.filter((s) => s.projectPath === projectPath).map((s) => ({ id: s.id, pane: null }));

    const dragged = currentRows[index];
    if (!dragged) return;

    setDragIndex(index);
    document.body.style.cursor = "grabbing";

    const drag = useSessionDragStore.getState();
    let overTerminal = false;

    const onMove = (ev: MouseEvent) => {
      const latestSplit = useSessionStore.getState().projectSplits.get(projectPath) ?? null;
      const isActiveProject = useSessionStore.getState().activeProjectPath === projectPath;

      // dropping onto the terminal area only makes sense for the visible project
      if (isActiveProject) {
        if (latestSplit) {
          const targetPane = contains(paneAreaFor(projectPath, 1), ev.clientX, ev.clientY)
            ? 1
            : contains(paneAreaFor(projectPath, 2), ev.clientX, ev.clientY)
              ? 2
              : null;
          if (targetPane && targetPane !== dragged.pane) {
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
        } else if (currentRows.length >= 2) {
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

      // reorder within the project's session list
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

        setDragIndex(null);
        setDropIndex(null);
        dropIndexRef.current = null;
        return;
      }

      const finalDrop = dropIndexRef.current;
      if (finalDrop !== null) {
        let target = finalDrop;
        if (target > index) target--;

        const latestSplit = store.projectSplits.get(projectPath) ?? null;
        if (!latestSplit) {
          if (target !== index && target >= 0 && target < currentRows.length) {
            store.reorderSessions(projectPath, index, target);
          }
        } else {
          const pane1Len = latestSplit.pane1.sessionIds.length;
          const targetPane: 1 | 2 = target < pane1Len ? 1 : 2;
          const targetLocal = targetPane === 1 ? target : target - pane1Len;
          if (targetPane === dragged.pane) {
            const sourceLocal = dragged.pane === 1 ? index : index - pane1Len;
            if (targetLocal !== sourceLocal) {
              store.reorderPaneSessions(projectPath, targetPane, sourceLocal, targetLocal);
            }
          } else {
            store.moveSessionToPane(projectPath, dragged.id, targetPane, targetLocal);
          }
        }
      }

      setDragIndex(null);
      setDropIndex(null);
      dropIndexRef.current = null;
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [projectPath]);

  if (rows.length === 0) return null;

  return (
    <div className="sidebar-sessions" ref={listRef}>
      {rows.map((row, index) => {
        const s = sessionById.get(row.id);
        if (!s) return null;
        const isEditor = s.sessionType === "editor";
        const isActive = s.id === activeSessionId && projectPath === activeProjectPath;
        const isPreview = s.isPreview === true;
        const status = isEditor ? null : tabStatuses.get(s.id) ?? null;
        const editorFile = editorFiles.get(s.id);
        const dirty = isEditor && !!editorFile && editorFile.content !== editorFile.savedContent;
        const label = isEditor ? s.fileName ?? "file" : sessionTitles.get(s.id) ?? s.projectName;

        let dropClass = "";
        if (dragIndex !== null && dropIndex !== null && dropIndex !== dragIndex && dropIndex !== dragIndex + 1) {
          if (dropIndex === index) dropClass = "drop-before";
          else if (dropIndex === rows.length && index === rows.length - 1) dropClass = "drop-after";
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
            <span className="sidebar-session-prefix">{getTabPrefix(s.sessionType)}</span>
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
            <span className="sidebar-session-trailing">
              {row.pane && <span className="sidebar-session-pane">[{row.pane}]</span>}
              {dirty ? (
                <span className="sidebar-session-status dirty">*</span>
              ) : status === "thinking" ? (
                <span className="sidebar-session-status thinking">*</span>
              ) : status === "waiting" ? (
                <span className="sidebar-session-status waiting">?</span>
              ) : null}
              <button
                type="button"
                className="sidebar-session-close"
                aria-label={`Close ${label}`}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); closeTab(s.id); }}
              >
                x
              </button>
            </span>
          </div>
        );
      })}
    </div>
  );
}
