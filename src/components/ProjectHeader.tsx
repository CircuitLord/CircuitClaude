import { useSessionStore } from "../stores/sessionStore";
import { useProjectStore } from "../stores/projectStore";
import { spawnNewSession } from "../lib/sessions";
import { useClaudeMdStore } from "../stores/claudeMdStore";
import { WindowControls } from "./WindowControls";

export function ProjectHeader() {
  const { activeProjectPath, sessions } = useSessionStore();
  const openClaudeMdEditor = useClaudeMdStore((s) => s.open);
  const { projects } = useProjectStore();

  if (!activeProjectPath) return null;

  const project = projects.find((p) => p.path === activeProjectPath);
  const projectName = project?.name ?? activeProjectPath.split(/[/\\]/).pop();
  const sessionCount = sessions.filter(
    (s) => s.projectPath === activeProjectPath
  ).length;

  return (
    <div className="project-header">
      <div className="project-header-info" data-tauri-drag-region>
        <span className="project-header-name">{projectName}</span>
        <span className="project-header-path">{activeProjectPath}</span>
        <button
          className="project-header-text-btn"
          onClick={() => openClaudeMdEditor(activeProjectPath)}
          title="Open project CLAUDE.md"
        >
          :claude.md
        </button>
      </div>
      <div className="project-header-actions">
        <span className="project-header-count">[{sessionCount}]</span>
        <button
          className="project-header-spawn"
          onClick={spawnNewSession}
          title="New session"
        >
+ new session
        </button>
      </div>
      <WindowControls />
    </div>
  );
}
