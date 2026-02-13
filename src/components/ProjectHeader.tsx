import { useSessionStore } from "../stores/sessionStore";
import { useProjectStore } from "../stores/projectStore";
import { useClaudeMdStore } from "../stores/claudeMdStore";
import { useNotesStore } from "../stores/notesStore";
import { WindowControls } from "./WindowControls";
import { NewSessionMenu } from "./NewSessionMenu";

export function ProjectHeader() {
  const { activeProjectPath, sessions } = useSessionStore();
  const openClaudeMdEditor = useClaudeMdStore((s) => s.open);
  const openAgentsMdEditor = useClaudeMdStore((s) => s.openAgents);
  const notesOpen = useNotesStore((s) => s.isOpen);
  const toggleNotes = useNotesStore((s) => s.toggle);
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
        <button
          className="project-header-text-btn"
          onClick={() => openClaudeMdEditor(activeProjectPath)}
          title="Open project CLAUDE.md"
        >
          :claude.md
        </button>
        <button
          className="project-header-text-btn"
          onClick={() => openAgentsMdEditor(activeProjectPath)}
          title="Open project agents.md"
        >
          :agents.md
        </button>
      </div>
      <div className="project-header-actions">
        <span className="project-header-count">[{sessionCount}]</span>
        <NewSessionMenu variant="pill" />
        <button
          className={`project-header-text-btn${notesOpen ? " active" : ""}`}
          onClick={toggleNotes}
          title="Toggle project notes"
        >
          :notes
        </button>
      </div>
      <WindowControls />
    </div>
  );
}
