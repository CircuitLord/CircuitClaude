import { useCallback, useEffect, useRef, useState } from "react";
import { useProjectStore } from "../stores/projectStore";
import { THEMES, THEME_OPTIONS } from "../lib/themes";
import { isRemotePath, remoteHostLabel } from "../lib/remote";
import type { ThemeName } from "../types";

/** edit mode: reorder, pin, recolor and remove projects */
export function SidebarProjects() {
  const projects = useProjectStore((s) => s.projects);
  const removeProject = useProjectStore((s) => s.removeProject);
  const reorderProjects = useProjectStore((s) => s.reorderProjects);
  const updateProjectTheme = useProjectStore((s) => s.updateProjectTheme);
  const togglePinned = useProjectStore((s) => s.togglePinned);

  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [themeOpen, setThemeOpen] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const dropIndexRef = useRef<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!confirmingDelete) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "y" || e.key === "Y") {
        e.preventDefault();
        removeProject(confirmingDelete!);
        setConfirmingDelete(null);
      } else if (e.key === "n" || e.key === "N" || e.key === "Escape") {
        e.preventDefault();
        setConfirmingDelete(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmingDelete, removeProject]);

  useEffect(() => {
    if (!themeOpen) return;
    function close() {
      setThemeOpen(null);
    }
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [themeOpen]);

  const handleGrabStart = useCallback((e: React.MouseEvent, index: number) => {
    if (e.button !== 0) return;
    e.preventDefault();

    setDragIndex(index);
    setConfirmingDelete(null);
    document.body.style.cursor = "grabbing";

    const snapshot = useProjectStore.getState().projects;

    const onMove = (ev: MouseEvent) => {
      if (!listRef.current) return;
      const rows = listRef.current.querySelectorAll<HTMLElement>(".sidebar-edit-row");
      let newDrop = rows.length;
      for (let i = 0; i < rows.length; i++) {
        const rect = rows[i].getBoundingClientRect();
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

      if (dropIndexRef.current !== null) {
        let target = dropIndexRef.current;
        if (target > index) target--;
        if (target !== index) {
          const order = [...snapshot];
          const [moved] = order.splice(index, 1);
          order.splice(target, 0, moved);
          reorderProjects(order.map((p) => p.path));
        }
      }

      setDragIndex(null);
      setDropIndex(null);
      dropIndexRef.current = null;
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [reorderProjects]);

  function handleSelectTheme(path: string, theme: ThemeName, e: React.MouseEvent) {
    e.stopPropagation();
    updateProjectTheme(path, theme);
    setThemeOpen(null);
  }

  return (
    <div className="sidebar-list" ref={listRef}>
      {projects.length === 0 && <div className="sidebar-sessions-empty">no projects yet</div>}
      {projects.map((p, index) => {
        const isConfirming = confirmingDelete === p.path;

        let dropClass = "";
        if (dragIndex !== null && dropIndex !== null && dropIndex !== dragIndex && dropIndex !== dragIndex + 1) {
          if (dropIndex === index) dropClass = "drop-before";
          else if (dropIndex === projects.length && index === projects.length - 1) dropClass = "drop-after";
        }

        const classes = [
          "sidebar-edit-row",
          dragIndex === index && "dragging",
          dropClass,
        ].filter(Boolean).join(" ");

        return (
          <div key={p.path} className={classes} title={p.path}>
            {isConfirming ? (
              <div className="sidebar-edit-confirm">
                <span className="sidebar-edit-confirm-text">remove?</span>
                <button
                  className="sidebar-edit-confirm-btn sidebar-edit-confirm-yes"
                  onClick={() => { removeProject(p.path); setConfirmingDelete(null); }}
                >
                  y
                </button>
                <span className="sidebar-edit-confirm-sep">/</span>
                <button
                  className="sidebar-edit-confirm-btn sidebar-edit-confirm-no"
                  onClick={() => setConfirmingDelete(null)}
                >
                  n
                </button>
              </div>
            ) : (
              <>
                <span className="sidebar-edit-handle" onMouseDown={(e) => handleGrabStart(e, index)}>
                  {"≡"}
                </span>
                <span className="sidebar-edit-name">{p.name}</span>
                {isRemotePath(p.path) && (
                  <span className="sidebar-edit-remote">@{remoteHostLabel(p.path)}</span>
                )}
                <button
                  className={`sidebar-edit-pin${p.pinned ? " pinned" : ""}`}
                  title={p.pinned ? "Unpin from sidebar" : "Keep in sidebar"}
                  onClick={() => togglePinned(p.path)}
                >
                  {p.pinned ? "[*]" : "[ ]"}
                </button>
                <div className="sidebar-edit-theme" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="sidebar-edit-swatch"
                    title="Change theme"
                    style={{ color: THEMES[p.theme]?.accent ?? THEMES.midnight.accent }}
                    onClick={() => setThemeOpen(themeOpen === p.path ? null : p.path)}
                  >
                    #
                  </button>
                  {themeOpen === p.path && (
                    <div className="sidebar-theme-dropdown">
                      {THEME_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          className={`sidebar-theme-option${opt.value === p.theme ? " active" : ""}`}
                          onClick={(e) => handleSelectTheme(p.path, opt.value, e)}
                        >
                          <span className="sidebar-theme-option-marker">{opt.value === p.theme ? ">" : ""}</span>
                          <span className="sidebar-theme-option-swatch" style={{ color: opt.accent }}>#</span>
                          <span className="sidebar-theme-option-label">{opt.label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  className="sidebar-edit-delete"
                  title="Remove project"
                  onClick={() => setConfirmingDelete(p.path)}
                >
                  x
                </button>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
