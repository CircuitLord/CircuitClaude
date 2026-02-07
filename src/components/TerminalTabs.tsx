import { useSessionStore } from "../stores/sessionStore";
import { TerminalView } from "./TerminalView";
import { killSession } from "../lib/pty";
import { deleteScrollback } from "../lib/config";
import { spawnNewSession, activateShellSession } from "../lib/sessions";

interface TerminalTabsProps {
  projectPath: string;
}

export function TerminalTabs({ projectPath }: TerminalTabsProps) {
  const { sessions, activeSessionId, setActiveSession, removeSession, streamingSessions, sessionTitles } =
    useSessionStore();

  const projectSessions = sessions.filter((s) => s.projectPath === projectPath);
  const shellSession = projectSessions.find((s) => s.isShell);
  const claudeSessions = projectSessions.filter((s) => !s.isShell);

  // All renderable sessions (shell + Claude sessions)
  const allVisible = [...(shellSession ? [shellSession] : []), ...claudeSessions];

  // If active session isn't in this project, fall back to first session
  const activeInProject = allVisible.find((s) => s.id === activeSessionId);
  const visibleSessionId = activeInProject?.id ?? claudeSessions[0]?.id ?? shellSession?.id ?? null;

  async function handleCloseSession(id: string) {
    const session = projectSessions.find((s) => s.id === id);
    if (session?.sessionId) {
      try {
        await killSession(session.sessionId);
      } catch {
        // Session may already be dead
      }
    }
    deleteScrollback(id).catch(() => {});
    removeSession(id);
  }

  if (projectSessions.length === 0) return null;

  const shellIsActive = shellSession?.id === visibleSessionId;

  return (
    <div className="terminal-tabs-container">
      <div className="terminal-tabs-bar">
        <button
          className={`terminal-tab-shell ${shellIsActive ? "terminal-tab-shell--active" : ""}`}
          onClick={() => activateShellSession()}
          title="Terminal"
        >
          &gt;_
        </button>
        {claudeSessions.map((s) => {
          const isActive = s.id === visibleSessionId;
          const isTabStreaming = streamingSessions.has(s.id);

          return (
            <button
              key={s.id}
              className={`terminal-tab ${isActive ? "terminal-tab--active" : ""}`}
              onClick={() => setActiveSession(s.id)}
            >
              <span className={`terminal-tab-prefix ${isActive ? "terminal-tab-prefix--active" : ""}`}>
                {">"}
              </span>
              <span className="terminal-tab-name">{sessionTitles.get(s.id) ?? s.projectName}</span>
              <span className="terminal-tab-trailing">
                {isTabStreaming ? (
                  <span className="terminal-tab-status terminal-tab-thinking">*</span>
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
        <button
          className="terminal-tab-add"
          onClick={() => spawnNewSession()}
          title="New session"
        >
          +
        </button>
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
              isShell={s.isShell}
              claudeSessionId={s.claudeSessionId}
              isRestored={s.restored}
              hideTitleBar
              onClose={() => handleCloseSession(s.id)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
