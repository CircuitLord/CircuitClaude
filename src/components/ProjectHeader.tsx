import { useSessionStore } from "../stores/sessionStore";
import { useProjectStore } from "../stores/projectStore";
import { useNotesStore } from "../stores/notesStore";
import { WindowControls } from "./WindowControls";
import { PinsDropdown } from "./PinsDropdown";
import { readClaudeMd, readAgentsMd } from "../lib/config";
import { openFileTab } from "../lib/sessions";

export function ProjectHeader() {
  const activeProjectPath = useSessionStore((s) => s.activeProjectPath);
  const notesOpen = useNotesStore((s) => s.isOpen);
  const toggleNotes = useNotesStore((s) => s.toggle);
  const { projects } = useProjectStore();

  if (!activeProjectPath) return null;

  const project = projects.find((p) => p.path === activeProjectPath);
  const projectName = project?.name ?? activeProjectPath.split(/[/\\]/).pop();
  return (
    <div className="project-header">
      <div className="project-header-info" data-tauri-drag-region>
        <span className="project-header-name">{projectName}</span>
        <button
          className="project-header-text-btn"
          onClick={() => readClaudeMd(activeProjectPath).then((r) => openFileTab(r.path, "CLAUDE.md", false))}
          title="Open project CLAUDE.md"
        >
          :claude.md
        </button>
        <button
          className="project-header-text-btn"
          onClick={() => readAgentsMd(activeProjectPath).then((r) => openFileTab(r.path, "agents.md", false))}
          title="Open project agents.md"
        >
          :agents.md
        </button>
      </div>
      <div className="project-header-actions">
        <PinsDropdown />
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
