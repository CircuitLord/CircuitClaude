import { useEffect, useState } from "react";
import { useProjectStore } from "../stores/projectStore";
import { useSessionStore } from "../stores/sessionStore";
import { useAddProject, AddProjectDialog } from "./AddProjectDialog";
import { GitSection } from "./GitSection";
import { SettingsDialog } from "./SettingsDialog";

export function Sidebar() {
  const { projects, loaded, load } = useProjectStore();
  const { sessions, activeProjectPath, setActiveProject, thinkingSessions, needsAttentionSessions } = useSessionStore();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const handleAdd = useAddProject();

  useEffect(() => {
    if (!loaded) load();
  }, [loaded, load]);

  function handleSelectProject(path: string) {
    setActiveProject(path);
  }

  return (
    <div className="sidebar">
      <div className="sidebar-header" data-tauri-drag-region>
        <span className="sidebar-header-label" data-tauri-drag-region>~/projects</span>
        <div className="sidebar-header-actions">
          <button className="sidebar-header-btn" onClick={handleAdd} title="Add project">
            +
          </button>
        </div>
      </div>
      <div className="sidebar-divider" />
      <div className="sidebar-list">
        {projects.map((p) => {
          const projectSessions = sessions.filter(
            (s) => s.projectPath === p.path
          );
          const sessionCount = projectSessions.length;
          const isThinking = projectSessions.some((s) => thinkingSessions.has(s.id));
          const needsAttention = projectSessions.some((s) => needsAttentionSessions.has(s.id));
          const isActive = p.path === activeProjectPath;

          const entryClasses = [
            "sidebar-entry",
            isActive && "active",
          ].filter(Boolean).join(" ");

          return (
            <div
              key={p.path}
              className={entryClasses}
              onClick={() => handleSelectProject(p.path)}
              title={p.path}
            >
              <span className="sidebar-entry-prefix">{">"}</span>
              <span className="sidebar-entry-name">{p.name}</span>
              {isThinking && <span className="sidebar-entry-alive">*</span>}
              {needsAttention && <span className="sidebar-entry-waiting">?</span>}
              {sessionCount > 0 && (
                <span className="sidebar-entry-count">[{sessionCount}]</span>
              )}
            </div>
          );
        })}
        <AddProjectDialog />
      </div>
      <GitSection />
      <button className="sidebar-settings-btn" onClick={() => setSettingsOpen(true)}>
        <span className="sidebar-settings-prefix">:</span>settings
      </button>
      <SettingsDialog isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
