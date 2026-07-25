import { useEffect } from "react";
import { useProjectStore } from "../stores/projectStore";
import { useSessionStore } from "../stores/sessionStore";
import { SidebarSessions } from "./SidebarSessions";
import { SettingsDialog } from "./SettingsDialog";
import { readClaudeMd } from "../lib/config";
import { openFileTab } from "../lib/sessions";
import { useSettingsStore } from "../stores/settingsStore";

export function Sidebar() {
  const { loaded, load } = useProjectStore();
  const setActiveSession = useSessionStore((s) => s.setActiveSession);
  const settingsOpen = useSettingsStore((s) => s.settingsDialogOpen);
  const openSettingsDialog = useSettingsStore((s) => s.openSettingsDialog);
  const closeSettingsDialog = useSettingsStore((s) => s.closeSettingsDialog);

  useEffect(() => {
    if (!loaded) load();
  }, [loaded, load]);

  return (
    <div className="sidebar">
      <div className="sidebar-header" data-tauri-drag-region>
        <span className="sidebar-header-label" data-tauri-drag-region>~/sessions</span>
        <div className="sidebar-header-actions">
          <button className="sidebar-header-btn" onClick={() => setActiveSession(null)} title="New chat">
            + new chat
          </button>
        </div>
      </div>
      <div className="sidebar-divider" />
      <SidebarSessions />
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
    </div>
  );
}
