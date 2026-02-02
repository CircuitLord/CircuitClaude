import { useSessionStore } from "../stores/sessionStore";

export function StatusBar() {
  const { sessions, activeProjectPath } = useSessionStore();

  const projectSessions = activeProjectPath
    ? sessions.filter((s) => s.projectPath === activeProjectPath)
    : [];

  return (
    <div className="status-bar">
      <div className="status-bar-left">
        {activeProjectPath ? (
          <span className="status-bar-path">{activeProjectPath}</span>
        ) : (
          <span>No project selected</span>
        )}
      </div>
      <div className="status-bar-right">
        {activeProjectPath && (
          <span>
            {projectSessions.length} session
            {projectSessions.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>
    </div>
  );
}
