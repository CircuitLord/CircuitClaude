import { useSessionStore, generateTabId } from "../stores/sessionStore";
import { useProjectStore } from "../stores/projectStore";
import { WindowControls } from "./WindowControls";

function PlusIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    >
      <path d="M7 3V11M3 7H11" />
    </svg>
  );
}

export function ProjectHeader() {
  const { activeProjectPath, sessions, addSession } = useSessionStore();
  const { projects } = useProjectStore();

  if (!activeProjectPath) return null;

  const project = projects.find((p) => p.path === activeProjectPath);
  const projectName = project?.name ?? activeProjectPath.split(/[/\\]/).pop();
  const sessionCount = sessions.filter(
    (s) => s.projectPath === activeProjectPath
  ).length;

  function handleSpawn() {
    if (!activeProjectPath) return;
    const id = generateTabId();
    addSession({
      id,
      projectName: projectName ?? "Unknown",
      projectPath: activeProjectPath,
      sessionId: null,
      claudeSessionId: crypto.randomUUID(),
      createdAt: Date.now(),
      restored: false,
    });
  }

  return (
    <div className="project-header">
      <div className="project-header-info" data-tauri-drag-region>
        <span className="project-header-name">{projectName}</span>
        <span className="project-header-path">{activeProjectPath}</span>
      </div>
      <div className="project-header-actions">
        <span className="project-header-count">
          {sessionCount} session{sessionCount !== 1 ? "s" : ""}
        </span>
        <button
          className="project-header-spawn"
          onClick={handleSpawn}
          title="New session"
        >
          <PlusIcon />
          <span>New Session</span>
        </button>
      </div>
      <WindowControls />
    </div>
  );
}
