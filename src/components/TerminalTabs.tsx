import { useSessionStore } from "../stores/sessionStore";
import { TerminalView } from "./TerminalView";
import { killSession } from "../lib/pty";
import { deleteScrollback } from "../lib/config";

interface TerminalTabsProps {
  projectPath: string;
}

export function TerminalTabs({ projectPath }: TerminalTabsProps) {
  const { sessions, activeSessionId, setActiveSession, removeSession, thinkingSessions, needsAttentionSessions, sessionTitles } =
    useSessionStore();

  const projectSessions = sessions.filter((s) => s.projectPath === projectPath);

  // If active session isn't in this project, fall back to first session
  const activeInProject = projectSessions.find((s) => s.id === activeSessionId);
  const visibleSessionId = activeInProject?.id ?? projectSessions[0]?.id ?? null;

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

  return (
    <div className="terminal-tabs-container">
      <div className="terminal-tabs-bar">
        {projectSessions.map((s) => {
          const isActive = s.id === visibleSessionId;
          const isThinking = thinkingSessions.has(s.id);
          const needsAttention = needsAttentionSessions.has(s.id);

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
                {isThinking && (
                  <span className="terminal-tab-status terminal-tab-thinking">*</span>
                )}
                {needsAttention && !isThinking && (
                  <span className="terminal-tab-status terminal-tab-attention">?</span>
                )}
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
      <div className="terminal-tabs-panels">
        {projectSessions.map((s) => (
          <div
            key={s.id}
            className="terminal-tabs-panel"
            style={{ display: s.id === visibleSessionId ? "flex" : "none" }}
          >
            <TerminalView
              tabId={s.id}
              projectPath={s.projectPath}
              projectName={s.projectName}
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
