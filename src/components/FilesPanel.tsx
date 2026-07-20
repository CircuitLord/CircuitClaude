import { useSessionStore } from "../stores/sessionStore";
import { useFileTreeStore } from "../stores/fileTreeStore";
import { FileTreeView } from "./FileTreeView";

export function FilesPanel() {
  const activeProjectPath = useSessionStore((s) => s.activeProjectPath);
  const { fetchDirectory, clearProject } = useFileTreeStore();

  if (!activeProjectPath) return null;

  function handleRefresh() {
    clearProject();
    fetchDirectory(activeProjectPath!);
  }

  return (
    <>
      <div className="right-panel-header">
        <span className="right-panel-title">~/files</span>
        <div className="right-panel-header-actions">
          <button className="right-panel-action" onClick={handleRefresh}>
            :refresh
          </button>
        </div>
      </div>
      <div className="sidebar-divider" />
      <div className="git-section-body">
        <FileTreeView projectPath={activeProjectPath} />
      </div>
    </>
  );
}
