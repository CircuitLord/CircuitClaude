import { useEffect } from "react";
import { useProjectStore } from "../stores/projectStore";
import { useSessionStore } from "../stores/sessionStore";
import { AddProjectDialog } from "./AddProjectDialog";
import { GitSection } from "./GitSection";

function FolderIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 4.5C2 3.67 2.67 3 3.5 3H6l1.5 1.5H12.5C13.33 4.5 14 5.17 14 6V11.5C14 12.33 13.33 13 12.5 13H3.5C2.67 13 2 12.33 2 11.5V4.5Z" />
    </svg>
  );
}

export function Sidebar() {
  const { projects, loaded, load } = useProjectStore();
  const { sessions, activeProjectPath, setActiveProject } = useSessionStore();

  useEffect(() => {
    if (!loaded) load();
  }, [loaded, load]);

  function handleSelectProject(path: string) {
    setActiveProject(path);
  }

  return (
    <div className="sidebar">
      <div className="sidebar-header" data-tauri-drag-region>Projects</div>
      <div className="sidebar-list">
        {projects.map((p) => {
          const sessionCount = sessions.filter(
            (s) => s.projectPath === p.path
          ).length;
          const isActive = p.path === activeProjectPath;
          const sessionText =
            sessionCount === 0
              ? null
              : sessionCount === 1
                ? "1 session"
                : `${sessionCount} sessions`;

          return (
            <div
              key={p.path}
              className={`sidebar-item ${isActive ? "active" : ""}`}
              onClick={() => handleSelectProject(p.path)}
              title={p.path}
            >
              <span className="sidebar-item-icon">
                <FolderIcon />
              </span>
              <div className="sidebar-item-content">
                <span className="sidebar-item-name">{p.name}</span>
                {sessionText && (
                  <span className="sidebar-item-meta">{sessionText}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <AddProjectDialog />
      <GitSection />
    </div>
  );
}
