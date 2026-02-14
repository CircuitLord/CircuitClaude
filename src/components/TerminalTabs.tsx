import { useEffect, useMemo, useState } from "react";
import { useSessionStore } from "../stores/sessionStore";
import { TerminalView } from "./TerminalView";
import { NewSessionMenu } from "./NewSessionMenu";
interface TerminalTabsProps {
  projectPath: string;
}

export function TerminalTabs({ projectPath }: TerminalTabsProps) {
  const { sessions, activeSessionId, setActiveSession, removeSession, tabStatuses, sessionTitles } =
    useSessionStore();

  const projectSessions = sessions.filter((s) => s.projectPath === projectPath);
  const shellSessions = projectSessions.filter((s) => s.sessionType === "shell");
  const agentSessions = projectSessions.filter((s) => s.sessionType !== "shell");

  // All renderable sessions (shells + agent sessions)
  const allVisible = useMemo(() => [...shellSessions, ...agentSessions], [shellSessions, agentSessions]);
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
  const visibleSessionId = activeInProject?.id ?? agentSessions[0]?.id ?? shellSessions[0]?.id ?? null;
  const sessionById = useMemo(
    () => new Map(allVisible.map((session) => [session.id, session])),
    [allVisible]
  );

  function handleCloseSession(id: string) {
    removeSession(id);
  }

  if (projectSessions.length === 0) return null;

  return (
    <div className="terminal-tabs-container">
      <div className="terminal-tabs-bar-wrapper">
        <div className="terminal-tabs-bar">
          {allVisible.map((s) => {
            const isActive = s.id === visibleSessionId;
            const tabStatus = tabStatuses.get(s.id) ?? null;
            const prefix =
              s.sessionType === "opencode"
                ? "o>"
                : s.sessionType === "codex"
                  ? "c>"
                  : s.sessionType === "shell"
                    ? ">_"
                    : ">";
            const label = s.sessionType === "shell" ? "terminal" : (sessionTitles.get(s.id) ?? s.projectName);

            return (
              <div
                key={s.id}
                className={`terminal-tab ${isActive ? "terminal-tab--active" : ""}`}
                role="tab"
                aria-selected={isActive}
                tabIndex={0}
                onClick={() => setActiveSession(s.id)}
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
                <span className="terminal-tab-name">{label}</span>
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
                      handleCloseSession(s.id);
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
                onClose={() => handleCloseSession(session.id)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
