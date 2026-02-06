import { Panel, Group, Separator } from "react-resizable-panels";
import { useSessionStore } from "../stores/sessionStore";
import { TerminalView } from "./TerminalView";
import { CompanionPanel } from "./CompanionPanel";
import { killSession } from "../lib/pty";
import { deleteScrollback } from "../lib/config";
import { spawnNewSession, activateShellSession } from "../lib/sessions";

interface TerminalTabsProps {
  projectPath: string;
}

export function TerminalTabs({ projectPath }: TerminalTabsProps) {
  const { sessions, activeSessionId, setActiveSession, removeSession, thinkingSessions, needsAttentionSessions, sessionTitles, companionVisible } =
    useSessionStore();

  const projectSessions = sessions.filter((s) => s.projectPath === projectPath);
  const shellSession = projectSessions.find((s) => s.isShell);
  const claudeSessions = projectSessions.filter((s) => !s.isShell);
  const confirmedSessions = claudeSessions.filter((s) => !s.restorePending);

  // All renderable sessions (shell + confirmed Claude sessions)
  const allVisible = [...(shellSession ? [shellSession] : []), ...claudeSessions];

  // If active session isn't in this project, fall back to first confirmed session
  const activeInProject = allVisible.find((s) => s.id === activeSessionId && !s.restorePending);
  const visibleSessionId = activeInProject?.id ?? confirmedSessions[0]?.id ?? shellSession?.id ?? null;

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

  const activeSession = allVisible.find((s) => s.id === visibleSessionId);
  const shellIsActive = shellSession?.id === visibleSessionId;

  const terminalPanels = (
    <div className="terminal-tabs-panels">
      {allVisible.map((s) => (
        <div
          key={s.id}
          className="terminal-tabs-panel"
          style={{ display: !s.restorePending && s.id === visibleSessionId ? "flex" : "none" }}
        >
          <TerminalView
            tabId={s.id}
            projectPath={s.projectPath}
            projectName={s.projectName}
            claudeSessionId={s.claudeSessionId}
            isRestored={s.restored}
            isShell={s.isShell}
            hideTitleBar
            onClose={() => handleCloseSession(s.id)}
          />
        </div>
      ))}
    </div>
  );

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
        {confirmedSessions.map((s) => {
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
                {needsAttention && (
                  <span className="terminal-tab-status terminal-tab-attention">?</span>
                )}
                {isThinking && !needsAttention && (
                  <span className="terminal-tab-status terminal-tab-thinking">*</span>
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
        <button
          className="terminal-tab-add"
          onClick={() => spawnNewSession()}
          title="New session"
        >
          +
        </button>
      </div>
      <Group orientation="horizontal" className="terminal-tabs-split">
        <Panel defaultSize={companionVisible ? 60 : 100} minSize={30}>
          {terminalPanels}
        </Panel>
        {companionVisible && (
          <>
            <Separator className="resize-handle-vertical" />
            <Panel defaultSize={40} minSize="25%" maxSize="70%">
              <CompanionPanel
                projectPath={projectPath}
                claudeSessionId={activeSession?.claudeSessionId}
              />
            </Panel>
          </>
        )}
      </Group>
    </div>
  );
}
