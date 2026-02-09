import { useEffect, useState, useRef, useCallback } from "react";
import { useProjectStore } from "../stores/projectStore";
import { useSessionStore } from "../stores/sessionStore";
import { useAddProject } from "./AddProjectDialog";
import { GitSection } from "./GitSection";
import { SettingsDialog } from "./SettingsDialog";
import { useClaudeMdStore } from "../stores/claudeMdStore";
import { THEMES, THEME_OPTIONS } from "../lib/themes";
import type { ThemeName } from "../types";

export function Sidebar() {
  const { projects, loaded, load, removeProject, reorderProjects, updateProjectTheme } = useProjectStore();
  const { sessions, activeProjectPath, setActiveProject, tabStatuses } = useSessionStore();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [themeDropdownPath, setThemeDropdownPath] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const dropIndexRef = useRef<number | null>(null);
  const handleAdd = useAddProject();
  const openClaudeMdEditor = useClaudeMdStore((s) => s.open);

  useEffect(() => {
    if (!loaded) load();
  }, [loaded, load]);

  // Exit edit mode if all projects removed
  useEffect(() => {
    if (editMode && projects.length === 0) {
      setEditMode(false);
    }
  }, [editMode, projects.length]);

  // Keyboard listener for y/n confirmation
  useEffect(() => {
    if (!confirmingDelete) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "y" || e.key === "Y") {
        e.preventDefault();
        removeProject(confirmingDelete!);
        setConfirmingDelete(null);
      } else if (e.key === "n" || e.key === "N" || e.key === "Escape") {
        e.preventDefault();
        setConfirmingDelete(null);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [confirmingDelete, removeProject]);

  function handleSelectProject(path: string) {
    if (editMode) return;
    setActiveProject(path);
  }

  const handleGrabStart = useCallback((e: React.MouseEvent, index: number) => {
    if (e.button !== 0) return;
    e.preventDefault();

    setDragIndex(index);
    setConfirmingDelete(null);
    document.body.style.cursor = "grabbing";

    // Snapshot projects at drag start (stable during the drag)
    const currentProjects = useProjectStore.getState().projects;

    const onMove = (ev: MouseEvent) => {
      if (!listRef.current) return;
      const entries = listRef.current.querySelectorAll<HTMLElement>(".sidebar-entry--edit");
      let newDrop = entries.length;

      for (let i = 0; i < entries.length; i++) {
        const rect = entries[i].getBoundingClientRect();
        if (ev.clientY < rect.top + rect.height / 2) {
          newDrop = i;
          break;
        }
      }

      dropIndexRef.current = newDrop;
      setDropIndex(newDrop);
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";

      const finalDrop = dropIndexRef.current;
      if (finalDrop !== null) {
        let targetIndex = finalDrop;
        if (targetIndex > index) targetIndex--;

        if (targetIndex !== index) {
          const newOrder = [...currentProjects];
          const [moved] = newOrder.splice(index, 1);
          newOrder.splice(targetIndex, 0, moved);
          reorderProjects(newOrder.map((p) => p.path));
        }
      }

      setDragIndex(null);
      setDropIndex(null);
      dropIndexRef.current = null;
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [reorderProjects]);

  function handleDeleteClick(path: string, e: React.MouseEvent) {
    e.stopPropagation();
    setConfirmingDelete(path);
  }

  function handleConfirmYes(path: string, e: React.MouseEvent) {
    e.stopPropagation();
    removeProject(path);
    setConfirmingDelete(null);
  }

  function handleConfirmNo(e: React.MouseEvent) {
    e.stopPropagation();
    setConfirmingDelete(null);
  }

  function toggleEditMode() {
    setEditMode(!editMode);
    setConfirmingDelete(null);
    setDragIndex(null);
    setDropIndex(null);
  }

  function handleToggleThemeDropdown(path: string, e: React.MouseEvent) {
    e.stopPropagation();
    setThemeDropdownPath(themeDropdownPath === path ? null : path);
  }

  function handleSelectTheme(path: string, theme: ThemeName, e: React.MouseEvent) {
    e.stopPropagation();
    updateProjectTheme(path, theme);
    setThemeDropdownPath(null);
  }

  // Close theme dropdown on outside click
  useEffect(() => {
    if (!themeDropdownPath) return;
    function handleClick() {
      setThemeDropdownPath(null);
    }
    window.addEventListener("click", handleClick);
    return () => window.removeEventListener("click", handleClick);
  }, [themeDropdownPath]);

  // Close theme dropdown when exiting edit mode
  useEffect(() => {
    if (!editMode) setThemeDropdownPath(null);
  }, [editMode]);

  return (
    <div className="sidebar">
      <div className="sidebar-header" data-tauri-drag-region>
        <span className="sidebar-header-label" data-tauri-drag-region>~/projects</span>
        <div className="sidebar-header-actions">
          {editMode ? (
            <button className="sidebar-header-text-btn" onClick={toggleEditMode}>
              :done
            </button>
          ) : (
            <>
              {projects.length > 0 && (
                <button className="sidebar-header-text-btn" onClick={toggleEditMode}>
                  :edit
                </button>
              )}
              <button className="sidebar-header-btn" onClick={handleAdd} title="Add project">
+ add
              </button>
            </>
          )}
        </div>
      </div>
      <div className="sidebar-divider" />
      <div
        className="sidebar-list"
        ref={listRef}
        onClick={() => { if (confirmingDelete) setConfirmingDelete(null); }}
      >
        {projects.map((p, index) => {
          const isConfirming = confirmingDelete === p.path;
          const isDragging = dragIndex === index;

          // Determine drop indicator placement
          let dropClass = "";
          if (dragIndex !== null && dropIndex !== null && dropIndex !== dragIndex && dropIndex !== dragIndex + 1) {
            if (dropIndex === index) dropClass = "drop-before";
            else if (dropIndex === projects.length && index === projects.length - 1) dropClass = "drop-after";
          }

          if (editMode) {
            const entryClasses = [
              "sidebar-entry",
              "sidebar-entry--edit",
              isDragging && "dragging",
              isConfirming && "confirming",
              dropClass,
            ].filter(Boolean).join(" ");

            return (
              <div
                key={p.path}
                className={entryClasses}
                title={p.path}
              >
                {isConfirming ? (
                  <div className="sidebar-entry-confirm" onClick={(e) => e.stopPropagation()}>
                    <span className="sidebar-entry-confirm-text">remove?</span>
                    <button className="sidebar-entry-confirm-btn sidebar-entry-confirm-yes" onClick={(e) => handleConfirmYes(p.path, e)}>y</button>
                    <span className="sidebar-entry-confirm-sep">/</span>
                    <button className="sidebar-entry-confirm-btn sidebar-entry-confirm-no" onClick={handleConfirmNo}>n</button>
                  </div>
                ) : (
                  <div className="sidebar-entry-line1">
                    <span
                      className="sidebar-entry-drag-handle"
                      onMouseDown={(e) => handleGrabStart(e, index)}
                    >
                      {"\u2261"}
                    </span>
                    <span className="sidebar-entry-name">{p.name}</span>
                    <div className="sidebar-theme-select" onClick={(e) => e.stopPropagation()}>
                      <button
                        className="sidebar-entry-theme-swatch"
                        onClick={(e) => handleToggleThemeDropdown(p.path, e)}
                        title="Change theme"
                        style={{ color: THEMES[p.theme]?.accent ?? THEMES.midnight.accent }}
                      >
                        #
                      </button>
                      {themeDropdownPath === p.path && (
                        <div className="sidebar-theme-dropdown">
                          {THEME_OPTIONS.map((opt) => (
                            <button
                              key={opt.value}
                              className={`sidebar-theme-option${opt.value === p.theme ? " sidebar-theme-option--active" : ""}`}
                              onClick={(e) => handleSelectTheme(p.path, opt.value, e)}
                            >
                              <span className="sidebar-theme-option-marker">{opt.value === p.theme ? ">" : " "}</span>
                              <span className="sidebar-theme-option-swatch" style={{ color: opt.accent }}>#</span>
                              <span className="sidebar-theme-option-label">{opt.label}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <button
                      className="sidebar-entry-delete"
                      onClick={(e) => handleDeleteClick(p.path, e)}
                      title="Remove project"
                    >
                      x
                    </button>
                  </div>
                )}
              </div>
            );
          }

          // Normal mode
          const projectSessions = sessions.filter(
            (s) => s.projectPath === p.path
          );
          const sessionCount = projectSessions.length;
          const isThinkingAny = projectSessions.some((s) => tabStatuses.get(s.id) === "thinking");
          const isWaitingAny = !isThinkingAny && projectSessions.some((s) => tabStatuses.get(s.id) === "waiting");
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
              <div className="sidebar-entry-line1">
                <span className="sidebar-entry-prefix">{">"}</span>
                <span className="sidebar-entry-name">{p.name}</span>
              </div>
              <div className="sidebar-entry-status">
                {isThinkingAny ? (
                  <span className="sidebar-entry-status-text alive"><span className="sidebar-entry-status-symbol">*</span> thinking</span>
                ) : isWaitingAny ? (
                  <span className="sidebar-entry-status-text waiting"><span className="sidebar-entry-status-symbol">?</span> waiting</span>
                ) : (
                  <span className="sidebar-entry-status-text idle">idle</span>
                )}
                {sessionCount > 0 && (
                  <span className="sidebar-entry-count">[{sessionCount} {sessionCount === 1 ? "session" : "sessions"}]</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <GitSection />
      <button className="sidebar-settings-btn" onClick={() => openClaudeMdEditor()}>
        <span className="sidebar-settings-prefix">:</span>global claude.md
      </button>
      <button className="sidebar-settings-btn" onClick={() => setSettingsOpen(true)}>
        <span className="sidebar-settings-prefix">:</span>settings
      </button>
      <SettingsDialog isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
