import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useSessionStore, findPane } from "../stores/sessionStore";
import { useSessionDragStore } from "../stores/sessionDragStore";
import type { DropZone } from "../stores/sessionDragStore";
import { useEditorStore } from "../stores/editorStore";
import { useProjectStore } from "../stores/projectStore";
import { useActionMenuStore } from "../stores/actionMenuStore";
import { archiveTab, pinTab } from "../lib/sessions";
import { getTabPrefix } from "../lib/sessionTypes";
import { isRemotePath, remoteHostLabel } from "../lib/remote";
import { THEMES } from "../lib/themes";
import type { SplitDirection, PaneState, Project, TerminalSession, ThemeName } from "../types";

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

interface SessionGroup {
  path: string;
  name: string;
  pinned: boolean;
  theme: ThemeName;
  sessions: TerminalSession[];
}

function ShimmerTitle({ label }: { label: string }) {
  const titleRef = useRef<HTMLSpanElement>(null);
  const charWidthRef = useRef(0);
  const [capacity, setCapacity] = useState<number | null>(null);
  const chars = Array.from(label);
  const visibleChars = capacity !== null && chars.length > capacity
    ? [...chars.slice(0, Math.max(0, capacity - 1)), ...Array(Math.min(1, capacity)).fill("…")]
    : chars;

  useLayoutEffect(() => {
    const title = titleRef.current!;
    const measure = () => {
      charWidthRef.current ||= title.firstElementChild!.getBoundingClientRect().width;
      setCapacity(Math.max(0, Math.floor(title.clientWidth / charWidthRef.current)));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(title);
    measure();
    return () => observer.disconnect();
  }, [label]);

  return (
    <span ref={titleRef} className="sidebar-session-name">
      {visibleChars.map((ch, i) => (
        <span
          key={i}
          className="shimmer-char"
          style={{ animationDelay: `${visibleChars.length > 1 ? (i / (visibleChars.length - 1)) * 4 : 0}s` }}
        >
          {ch}
        </span>
      ))}
    </span>
  );
}

/** pinned projects always get a section, unpinned ones only while they hold sessions. both keep the user's project order */
function buildGroups(projects: Project[], sessions: TerminalSession[]): SessionGroup[] {
  const toGroup = (p: Project): SessionGroup => ({
    path: p.path,
    name: p.name,
    pinned: p.pinned === true,
    theme: p.theme,
    sessions: sessions.filter((s) => s.projectPath === p.path),
  });

  const pinned = projects.filter((p) => p.pinned).map(toGroup);
  const transient = projects
    .filter((p) => !p.pinned && sessions.some((s) => s.projectPath === p.path))
    .map(toGroup);

  return [...pinned, ...transient];
}

export function SidebarSessions() {
  const sessions = useSessionStore((s) => s.sessions);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const activeProjectPath = useSessionStore((s) => s.activeProjectPath);
  const tabStatuses = useSessionStore((s) => s.tabStatuses);
  const completedTabs = useSessionStore((s) => s.completedTabs);
  const sessionTitles = useSessionStore((s) => s.sessionTitles);
  const projectSplits = useSessionStore((s) => s.projectSplits);
  const activateSession = useSessionStore((s) => s.activateSession);
  const setActiveProject = useSessionStore((s) => s.setActiveProject);
  const projects = useProjectStore((s) => s.projects);
  // subscribe so dirty markers refresh
  const editorFiles = useEditorStore((s) => s.files);

  const [drag, setDrag] = useState<{ path: string; index: number } | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const dropIndexRef = useRef<number | null>(null);

  const handleDragStart = useCallback((e: React.MouseEvent, projectPath: string, index: number, sessionId: string) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest(".sidebar-session-close")) return;
    e.preventDefault();
    e.stopPropagation();

    const dragged = useSessionStore.getState().sessions.find((s) => s.id === sessionId);
    if (!dragged) return;

    setDrag({ path: projectPath, index });
    document.body.style.cursor = "grabbing";

    const drop = useSessionDragStore.getState();
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
              drop.start(dragged.id, projectPath);
              setDrag(null);
              setDropIndex(null);
              dropIndexRef.current = null;
            }
            drop.setTarget(null, targetPane);
            return;
          }
        } else if (projectSessionCount >= 2) {
          const panels = panelsAreaFor(projectPath);
          if (contains(panels, ev.clientX, ev.clientY)) {
            if (!overTerminal) {
              overTerminal = true;
              drop.start(dragged.id, projectPath);
              setDrag(null);
              setDropIndex(null);
              dropIndexRef.current = null;
            }
            drop.setTarget(computeDropZone(panels!, ev.clientX, ev.clientY), null);
            return;
          }
        }
      }

      if (overTerminal) {
        overTerminal = false;
        useSessionDragStore.getState().end();
        setDrag({ path: projectPath, index });
      }

      // reordering is confined to the section it started in — a session can't change project
      const rows = document.querySelectorAll<HTMLElement>(
        `.sidebar-project-children[data-project="${CSS.escape(projectPath)}"] .sidebar-session`
      );
      let newDrop = rows.length;
      for (let i = 0; i < rows.length; i++) {
        const rect = rows[i].getBoundingClientRect();
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
        store.moveProjectSession(projectPath, index, target);
      }

      setDrag(null);
      setDropIndex(null);
      dropIndexRef.current = null;
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  const groups = buildGroups(projects, sessions);

  return (
    <div className="sidebar-list">
      <button
        className={`sidebar-new-chat${activeProjectPath === null ? " selected" : ""}`}
        title="New chat (Ctrl+T)"
        onClick={() => useActionMenuStore.getState().open("new-chat")}
      >
        <span className="sidebar-new-chat-prefix">+</span>
        <span>new chat</span>
      </button>
      {groups.map((group) => {
        const theme = THEMES[group.theme] ?? THEMES.midnight;
        const style: CSSProperties = {
          "--sidebar-project-accent": theme.css["--accent"],
          "--sidebar-project-accent-text": theme.css["--accent-text"],
          "--sidebar-project-accent-muted": theme.css["--accent-muted"],
          "--sidebar-project-accent-muted-hover": theme.css["--accent-muted-hover"],
          "--sidebar-project-text-tertiary": theme.css["--text-tertiary"],
        } as CSSProperties;
        const isActiveProject = group.path === activeProjectPath;
        // the launcher is showing for this project, so the header itself is the selected row
        const isSelected = isActiveProject && activeSessionId === null;
        const headerClasses = ["sidebar-project-header", isActiveProject && "active", isSelected && "selected"]
          .filter(Boolean).join(" ");

        return (
          <div className="sidebar-project" key={group.path} style={style}>
            <div className={headerClasses}>
              <button
                className="sidebar-project-btn"
                title={group.path}
                onClick={() => setActiveProject(group.path)}
              >
                <span className="sidebar-project-prefix">~/</span>
                <span className="sidebar-project-name">{group.name}</span>
                {isRemotePath(group.path) && (
                  <span className="sidebar-project-remote">@{remoteHostLabel(group.path)}</span>
                )}
                {group.pinned && <span className="sidebar-project-pinned" title="pinned">[*]</span>}
                {group.sessions.length > 0 && (
                  <span className="sidebar-project-count">[{group.sessions.length}]</span>
                )}
              </button>
            </div>

            <div className="sidebar-project-children" data-project={group.path}>
              {group.sessions.map((s, index) => {
                const isEditor = s.sessionType === "editor";
                const isActive = s.id === activeSessionId;
                const isPreview = s.isPreview === true;
                const status = isEditor ? null : tabStatuses.get(s.id) ?? null;
                const isCompleted = !isEditor && completedTabs.has(s.id);
                const editorFile = editorFiles.get(s.id);
                const dirty = isEditor && !!editorFile && editorFile.content !== editorFile.savedContent;
                const label = isEditor ? s.fileName ?? "file" : sessionTitles.get(s.id) ?? s.projectName;
                const split = projectSplits.get(s.projectPath);
                const pane = split ? findPane(split, s.id) : null;
                const dragging = drag?.path === group.path && drag.index === index;

                let dropClass = "";
                if (drag?.path === group.path && dropIndex !== null && dropIndex !== drag.index && dropIndex !== drag.index + 1) {
                  if (dropIndex === index) dropClass = "drop-before";
                  else if (dropIndex === group.sessions.length && index === group.sessions.length - 1) dropClass = "drop-after";
                }

                const classes = [
                  "sidebar-session",
                  isActive && "active",
                  isPreview && "preview",
                  status === "thinking" && "thinking",
                  isCompleted && "completed",
                  dragging && "dragging",
                  dropClass,
                ].filter(Boolean).join(" ");

                return (
                  <div
                    key={s.id}
                    className={classes}
                    role="tab"
                    aria-selected={isActive}
                    aria-label={label}
                    tabIndex={0}
                    title={label}
                    onClick={(e) => { e.stopPropagation(); activateSession(s.id); }}
                    onDoubleClick={() => { if (isPreview) pinTab(s.id); }}
                    onMouseDown={(e) => handleDragStart(e, group.path, index, s.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        activateSession(s.id);
                      }
                    }}
                  >
                    <span className="sidebar-session-prefix">{getTabPrefix(s.sessionType)}</span>
                    <ShimmerTitle label={label} />
                    <span className="sidebar-session-trailing">
                      {pane && <span className="sidebar-session-pane">[{pane}]</span>}
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
                        aria-label={isEditor ? `Close ${label}` : `Archive ${label}`}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => { e.stopPropagation(); archiveTab(s.id); }}
                      >
                        x
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

    </div>
  );
}
