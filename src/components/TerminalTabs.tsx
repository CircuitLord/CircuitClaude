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
  const allVisible = [...shellSessions, ...agentSessions];

  // If active session isn't in this project, fall back to first session
  const activeInProject = allVisible.find((s) => s.id === activeSessionId);
  const visibleSessionId = activeInProject?.id ?? agentSessions[0]?.id ?? shellSessions[0]?.id ?? null;

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
              <button
                key={s.id}
                className={`terminal-tab ${isActive ? "terminal-tab--active" : ""}`}
                onClick={() => setActiveSession(s.id)}
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
                  <span
                    className="terminal-tab-close"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCloseSession(s.id);
                    }}
                  >
                    x
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        <NewSessionMenu variant="button" />
      </div>
      <div className="terminal-tabs-panels">
        {allVisible.map((s) => (
          <div
            key={s.id}
            className="terminal-tabs-panel"
            style={{ display: s.id === visibleSessionId ? "flex" : "none" }}
          >
            <TerminalView
              tabId={s.id}
              projectPath={s.projectPath}
              projectName={s.projectName}
              sessionType={s.sessionType}
              hideTitleBar
              onClose={() => handleCloseSession(s.id)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
