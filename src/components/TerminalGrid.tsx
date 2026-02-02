import { useSessionStore } from "../stores/sessionStore";
import { TerminalView } from "./TerminalView";
import { killSession } from "../lib/pty";

function getGridColumns(count: number): string {
  if (count <= 1) return "1fr";
  if (count <= 4) return "1fr 1fr";
  if (count <= 6) return "1fr 1fr";
  return "1fr 1fr 1fr";
}

export function TerminalGrid() {
  const { sessions, activeProjectPath, removeSession } = useSessionStore();

  const projectSessions = sessions.filter(
    (s) => s.projectPath === activeProjectPath
  );

  async function handleCloseSession(id: string) {
    const session = projectSessions.find((s) => s.id === id);
    if (session?.sessionId) {
      try {
        await killSession(session.sessionId);
      } catch {
        // Session may already be dead
      }
    }
    removeSession(id);
  }

  return (
    <div
      className="terminal-grid"
      style={{
        gridTemplateColumns: getGridColumns(projectSessions.length),
      }}
    >
      {projectSessions.map((s) => (
        <div key={s.id} className="grid-cell">
          <TerminalView
            tabId={s.id}
            projectPath={s.projectPath}
            onClose={() => handleCloseSession(s.id)}
          />
        </div>
      ))}
    </div>
  );
}
