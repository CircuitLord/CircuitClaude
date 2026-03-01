import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSessionStore } from "../stores/sessionStore";
import { TerminalView } from "./TerminalView";
import { NewSessionMenu } from "./NewSessionMenu";
import { closePtySession } from "../lib/pty";
interface TerminalTabsProps {
  projectPath: string;
}

export function TerminalTabs({ projectPath }: TerminalTabsProps) {
  const { sessions, activeSessionId, setActiveSession, removeSession, tabStatuses, sessionTitles, requestTitleRegen, reorderSessions } =
    useSessionStore();

  const tabBarRef = useRef<HTMLDivElement>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const dropIndexRef = useRef<number | null>(null);

  const projectSessions = sessions.filter((s) => s.projectPath === projectPath);

  // Keep tabs in creation order (same as store insertion order)
  const allVisible = projectSessions;
  const visibleSessionIds = useMemo(() => allVisible.map((s) => s.id), [allVisible]);
  const [mountedSessionIds, setMountedSessionIds] = useState<string[]>(visibleSessionIds);

  // Keep panel instances stable when earlier tabs are removed/reordered.
  useEffect(() => {
    setMountedSessionIds((prev) => {
      const visibleSet = new Set(visibleSessionIds);
      const next: string[] = [];

      for (const id of prev) {
        if (visibleSet.has(id)) next.push(id);
      }

      const nextSet = new Set(next);
      for (const id of visibleSessionIds) {
        if (!nextSet.has(id)) {
          next.push(id);
          nextSet.add(id);
        }
      }

      if (next.length === prev.length && next.every((id, idx) => id === prev[idx])) {
        return prev;
      }
      return next;
    });
  }, [visibleSessionIds]);

  // If active session isn't in this project, fall back to first session
  const activeInProject = allVisible.find((s) => s.id === activeSessionId);
  const visibleSessionId = activeInProject?.id ?? allVisible[0]?.id ?? null;
  const sessionById = useMemo(
    () => new Map(allVisible.map((session) => [session.id, session])),
    [allVisible]
  );

  async function handleCloseSession(id: string) {
    const session = sessions.find((s) => s.id === id);
    if (session?.sessionId) {
      await closePtySession(session.sessionId).catch(() => {});
    }
    removeSession(id);
  }

  const handleTabDragStart = useCallback((e: React.MouseEvent, index: number) => {
    if (e.button !== 0) return;
    // Don't start drag from the close button
    if ((e.target as HTMLElement).closest(".terminal-tab-close")) return;
    e.preventDefault();

    setDragIndex(index);
    document.body.style.cursor = "grabbing";

    const currentSessions = useSessionStore.getState().sessions.filter((s) => s.projectPath === projectPath);

    const onMove = (ev: MouseEvent) => {
      if (!tabBarRef.current) return;
      const tabs = tabBarRef.current.querySelectorAll<HTMLElement>(".terminal-tab");
      let newDrop = tabs.length;

      for (let i = 0; i < tabs.length; i++) {
        const rect = tabs[i].getBoundingClientRect();
        if (ev.clientX < rect.left + rect.width / 2) {
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

      const finalDrop = dropIndexRef.current;
      if (finalDrop !== null) {
        let targetIndex = finalDrop;
        if (targetIndex > index) targetIndex--;

        if (targetIndex !== index && targetIndex >= 0 && targetIndex < currentSessions.length) {
          reorderSessions(projectPath, index, targetIndex);
        }
      }

      setDragIndex(null);
      setDropIndex(null);
      dropIndexRef.current = null;
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [projectPath, reorderSessions]);

  if (projectSessions.length === 0) return null;

  return (
    <div className="terminal-tabs-container">
      <div className="terminal-tabs-bar-wrapper">
        <div className="terminal-tabs-bar" ref={tabBarRef}>
          {allVisible.map((s, index) => {
            const isActive = s.id === visibleSessionId;
            const tabStatus = tabStatuses.get(s.id) ?? null;
            const isDragging = dragIndex === index;
            const prefix =
              s.sessionType === "opencode"
                ? "o>"
                : s.sessionType === "codex"
                  ? "c>"
                  : s.sessionType === "shell"
                    ? ">_"
                    : ">";
            const label = s.sessionType === "shell" ? "terminal" : (sessionTitles.get(s.id) ?? s.projectName);

            let dropClass = "";
            if (dragIndex !== null && dropIndex !== null && dropIndex !== dragIndex && dropIndex !== dragIndex + 1) {
              if (dropIndex === index) dropClass = " terminal-tab--drop-before";
              else if (dropIndex === allVisible.length && index === allVisible.length - 1) dropClass = " terminal-tab--drop-after";
            }

            return (
              <div
                key={s.id}
                className={`terminal-tab ${isActive ? "terminal-tab--active" : ""}${tabStatus === "thinking" ? " terminal-tab--thinking" : ""}${isDragging ? " terminal-tab--dragging" : ""}${dropClass}`}
                role="tab"
                aria-selected={isActive}
                tabIndex={0}
                onClick={() => setActiveSession(s.id)}
                onMouseDown={(e) => handleTabDragStart(e, index)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setActiveSession(s.id);
                  }
                }}
              >
                <span className="terminal-tab-prefix">
                  {prefix}
                </span>
                <span
                  className="terminal-tab-name"
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    if (s.sessionType !== "shell") requestTitleRegen(s.id);
                  }}
                >{label}</span>
                <span className="terminal-tab-trailing">
                  {tabStatus === "thinking" ? (
                    <span className="terminal-tab-status terminal-tab-thinking">*</span>
                  ) : tabStatus === "waiting" ? (
                    <span className="terminal-tab-status terminal-tab-attention">?</span>
                  ) : null}
                  <button
                    type="button"
                    className="terminal-tab-close"
                    aria-label={`Close ${label} tab`}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleCloseSession(s.id);
                    }}
                  >
                    x
                  </button>
                </span>
              </div>
            );
          })}
        </div>
        <NewSessionMenu variant="button" />
      </div>
      <div className="terminal-tabs-panels">
        {mountedSessionIds.map((id) => {
          const session = sessionById.get(id);
          if (!session) return null;
          return (
            <div
              key={session.id}
              className="terminal-tabs-panel"
              style={{ display: session.id === visibleSessionId ? "flex" : "none" }}
            >
              <TerminalView
                tabId={session.id}
                projectPath={session.projectPath}
                projectName={session.projectName}
                sessionType={session.sessionType}
                hideTitleBar
                onClose={() => {
                  void handleCloseSession(session.id);
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
