import { useEffect, useState } from "react";
import { useProjectStore } from "../stores/projectStore";
import { SidebarSessions } from "./SidebarSessions";
import { SidebarProjects } from "./SidebarProjects";
import { SettingsDialog } from "./SettingsDialog";
import { AddProjectDialog } from "./AddProjectDialog";
import { readClaudeMd } from "../lib/config";
import { openFileTab } from "../lib/sessions";
import { useSettingsStore } from "../stores/settingsStore";

export function Sidebar() {
  const { projects, loaded, load } = useProjectStore();
  const settingsOpen = useSettingsStore((s) => s.settingsDialogOpen);
  const openSettingsDialog = useSettingsStore((s) => s.openSettingsDialog);
  const closeSettingsDialog = useSettingsStore((s) => s.closeSettingsDialog);
  const [editMode, setEditMode] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    if (!loaded) load();
  }, [loaded, load]);

  useEffect(() => {
    if (editMode && projects.length === 0) setEditMode(false);
  }, [editMode, projects.length]);

  return (
    <div className="sidebar">
      <div className="sidebar-header" data-tauri-drag-region>
        <span className="sidebar-header-label" data-tauri-drag-region>
          {editMode ? "~/projects" : "~/sessions"}
        </span>
        <div className="sidebar-header-actions">
          {editMode ? (
            <button className="sidebar-header-text-btn" onClick={() => setEditMode(false)}>
              :done
            </button>
          ) : (
            <>
              {projects.length > 0 && (
                <button className="sidebar-header-text-btn" onClick={() => setEditMode(true)}>
                  :edit
                </button>
              )}
              <button className="sidebar-header-btn" onClick={() => setAddOpen(true)} title="Add project">
                + add
              </button>
            </>
          )}
        </div>
      </div>
      <div className="sidebar-divider" />
      {editMode ? <SidebarProjects /> : <SidebarSessions />}
      <div className="sidebar-footer">
        <button className="sidebar-footer-btn" onClick={() => readClaudeMd().then((r) => openFileTab(r.path, "CLAUDE.md", false))}>
          :claude.md
        </button>
        <span className="sidebar-footer-sep">·</span>
        <button className="sidebar-footer-btn" onClick={openSettingsDialog}>
          :settings
        </button>
      </div>
      <SettingsDialog isOpen={settingsOpen} onClose={closeSettingsDialog} />
      <AddProjectDialog isOpen={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  );
}
