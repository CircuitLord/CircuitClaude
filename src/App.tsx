import { Sidebar } from "./components/Sidebar";
import { ProjectHeader } from "./components/ProjectHeader";
import { TerminalGrid } from "./components/TerminalGrid";
import { EmptyState } from "./components/EmptyState";
import { StatusBar } from "./components/StatusBar";
import { useSessionStore, generateTabId } from "./stores/sessionStore";
import { useProjectStore } from "./stores/projectStore";
import "./App.css";

function App() {
  const { sessions, activeProjectPath, addSession } = useSessionStore();
  const { projects } = useProjectStore();

  const projectSessions = activeProjectPath
    ? sessions.filter((s) => s.projectPath === activeProjectPath)
    : [];

  function handleSpawnForProject() {
    if (!activeProjectPath) return;
    const project = projects.find((p) => p.path === activeProjectPath);
    const name = project?.name ?? activeProjectPath.split(/[/\\]/).pop() ?? "Unknown";
    const id = generateTabId();
    addSession({
      id,
      projectName: name,
      projectPath: activeProjectPath,
      sessionId: null,
    });
  }

  return (
    <div className="app">
      <Sidebar />
      <div className="main-panel">
        {activeProjectPath ? (
          <>
            <ProjectHeader />
            {projectSessions.length === 0 ? (
              <div className="terminal-area">
                <EmptyState
                  variant="no-sessions"
                  onSpawn={handleSpawnForProject}
                />
              </div>
            ) : (
              <TerminalGrid />
            )}
          </>
        ) : (
          <div className="terminal-area">
            <EmptyState />
          </div>
        )}
        <StatusBar />
      </div>
    </div>
  );
}

export default App;
