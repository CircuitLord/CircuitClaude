import { useSessionStore } from "../stores/sessionStore";
import { useProjectStore } from "../stores/projectStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useGitStore } from "../stores/gitStore";
import { WindowControls } from "./WindowControls";
import { readClaudeMd, readAgentsMd } from "../lib/config";
import { openFileTab } from "../lib/sessions";
import type { RightPanelTab } from "../types";

const PANEL_TABS: Array<{ label: string; value: RightPanelTab }> = [
  { label: ":files", value: "files" },
  { label: ":source", value: "source" },
  { label: ":notes", value: "notes" },
  { label: ":pins", value: "pins" },
];

export function ProjectHeader() {
  const activeProjectPath = useSessionStore((s) => s.activeProjectPath);
  const activeTab = useSettingsStore((s) => s.settings.rightPanelTab);
  const toggleRightPanelTab = useSettingsStore((s) => s.toggleRightPanelTab);
  const changeCount = useGitStore((s) =>
    activeProjectPath ? s.statuses[activeProjectPath]?.files.length ?? 0 : 0
  );
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
        <div className="panel-tabs">
          {PANEL_TABS.map((t) => (
            <button
              key={t.value}
              className={`panel-tab${activeTab === t.value ? " active" : ""}`}
              onClick={() => toggleRightPanelTab(t.value)}
              title={`Toggle ${t.value} panel`}
            >
              {t.label}
              {t.value === "source" && changeCount > 0 && (
                <span className="panel-tab-badge">[{changeCount}]</span>
              )}
            </button>
          ))}
        </div>
      </div>
      <WindowControls />
    </div>
  );
}
