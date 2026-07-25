import { useEffect, useRef, useState } from "react";
import { spawnNewSession } from "../lib/sessions";
import { useSettingsStore } from "../stores/settingsStore";
import { useProjectStore } from "../stores/projectStore";
import { useSessionStore } from "../stores/sessionStore";
import { AddProjectDialog } from "./AddProjectDialog";
import { getProjectSessionTypes } from "../lib/sessionTypes";
import { THEMES } from "../lib/themes";
import { displayPath, isRemotePath, remoteHostLabel } from "../lib/remote";

export function SessionLauncher() {
  const activeProjectPath = useSessionStore((s) => s.activeProjectPath);
  const setActiveProject = useSessionStore((s) => s.setActiveProject);
  const projects = useProjectStore((s) => s.projects);
  const removeProject = useProjectStore((s) => s.removeProject);
  const togglePinned = useProjectStore((s) => s.togglePinned);
  const editableSessionTypes = useSettingsStore((s) => s.settings.sessionTypes);
  const defaultSessionType = useSettingsStore((s) => s.settings.defaultSessionType);

  const [addOpen, setAddOpen] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // only arrow keys should scroll, or hovering a clipped row scrolls it under the cursor and loops
  const keyNavRef = useRef(false);

  const project = projects.find((p) => p.path === activeProjectPath) ?? null;
  const sessionTypes = getProjectSessionTypes(project?.path ?? null, editableSessionTypes);

  const needle = query.trim().toLowerCase();
  // pinned projects are the ones you reach for, so they lead the list
  const ordered = [...projects].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned));
  const filtered = needle
    ? ordered.filter((p) => p.name.toLowerCase().includes(needle) || p.path.toLowerCase().includes(needle))
    : ordered;

  useEffect(() => {
    if (!projectOpen) return;
    function closeAll() {
      setProjectOpen(false);
      setConfirmingDelete(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeAll();
    }
    window.addEventListener("click", closeAll);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", closeAll);
      window.removeEventListener("keydown", onKey);
    };
  }, [projectOpen]);

  // opening starts fresh, with the cursor on the project you're already in
  useEffect(() => {
    if (!projectOpen) return;
    setQuery("");
    const current = ordered.findIndex((p) => p.path === activeProjectPath);
    keyNavRef.current = true;
    setHighlight(current === -1 ? 0 : current);
    inputRef.current?.focus();
  }, [projectOpen]);

  useEffect(() => {
    if (!keyNavRef.current) return;
    keyNavRef.current = false;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${highlight}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  function handleSelectProject(path: string) {
    setActiveProject(path);
    setProjectOpen(false);
  }

  function handleSearchKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      keyNavRef.current = true;
      setHighlight((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      keyNavRef.current = true;
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const picked = filtered[highlight];
      if (!picked) return;
      // enter is the fast path — straight into a default session; shift just switches project
      if (e.shiftKey) {
        handleSelectProject(picked.path);
      } else {
        setProjectOpen(false);
        spawnNewSession(defaultSessionType, picked.path);
      }
    }
  }

  const openClass = projectOpen ? " project-open" : "";

  return (
    <div className={`session-launcher${openClass}`}>
      <div className="session-launcher-content">
        <div className="launcher-project" onClick={(e) => e.stopPropagation()}>
          <button
            className="launcher-project-btn"
            aria-expanded={projectOpen}
            onClick={() => setProjectOpen((v) => !v)}
          >
            <span className="launcher-project-label">
              <span className="launcher-project-prefix">~/</span>
              <span className="launcher-project-name">{project?.name ?? "select a project"}</span>
            </span>
          </button>

          {projectOpen && (
            <div className="launcher-dropdown launcher-dropdown--up">
              <div className="launcher-dropdown-search">
                <span className="launcher-dropdown-search-prefix">/</span>
                <input
                  ref={inputRef}
                  className="launcher-dropdown-search-input"
                  value={query}
                  placeholder="filter projects"
                  spellCheck={false}
                  onChange={(e) => { setQuery(e.target.value); setHighlight(0); }}
                  onKeyDown={handleSearchKeyDown}
                />
              </div>
              <div className="launcher-dropdown-list" ref={listRef}>
                {filtered.length === 0 && (
                  <div className="launcher-dropdown-empty">
                    {projects.length === 0 ? "no projects yet" : "no matches"}
                  </div>
                )}
                {filtered.map((p, i) => {
                  const isCursor = i === highlight;
                  return (
                    <div
                      key={p.path}
                      className={`launcher-dropdown-row${isCursor ? " highlighted" : ""}`}
                      data-index={i}
                      onMouseEnter={() => setHighlight(i)}
                    >
                      {confirmingDelete === p.path ? (
                        <div className="launcher-dropdown-confirm">
                          <span className="launcher-dropdown-confirm-text">remove {p.name}?</span>
                          <button
                            className="launcher-dropdown-confirm-yes"
                            onClick={() => { removeProject(p.path); setConfirmingDelete(null); }}
                          >
                            y
                          </button>
                          <span className="launcher-dropdown-confirm-sep">/</span>
                          <button className="launcher-dropdown-confirm-no" onClick={() => setConfirmingDelete(null)}>
                            n
                          </button>
                        </div>
                      ) : (
                        <>
                          <button
                            className="launcher-dropdown-option"
                            onClick={() => handleSelectProject(p.path)}
                            title={p.path}
                          >
                            <span className="launcher-dropdown-marker">{isCursor ? ">" : ""}</span>
                            <span className="launcher-dropdown-swatch" style={{ color: THEMES[p.theme]?.accent }}>#</span>
                            <span className="launcher-dropdown-label">{p.name}</span>
                            {isRemotePath(p.path) && (
                              <span className="launcher-dropdown-remote">@{remoteHostLabel(p.path)}</span>
                            )}
                          </button>
                          <button
                            className={`launcher-dropdown-pin${p.pinned ? " pinned" : ""}`}
                            title={p.pinned ? "Unpin from sidebar" : "Keep in sidebar"}
                            onClick={() => togglePinned(p.path)}
                          >
                            {p.pinned ? "[*]" : "[ ]"}
                          </button>
                          <button
                            className="launcher-dropdown-remove"
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
              <button
                className="launcher-dropdown-add"
                onClick={() => { setProjectOpen(false); setAddOpen(true); }}
              >
                + add project
              </button>
            </div>
          )}
        </div>

        <div className="launcher-project-meta">
          {project ? (
            <span className="launcher-project-path" title={project.path}>{displayPath(project.path)}</span>
          ) : (
            <span className="launcher-project-path">pick a project to start a session</span>
          )}
        </div>

        {project && (
          <div className="session-launcher-list">
            <div className="session-launcher-list-label">new session</div>
            {sessionTypes.map((st) => (
              <button
                key={st.id}
                className="session-launcher-entry"
                onClick={() => spawnNewSession(st.id, project.path)}
              >
                <span className="session-launcher-entry-prefix">{st.prefix ?? ">"}</span>
                <span className="session-launcher-entry-name">{st.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <AddProjectDialog isOpen={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  );
}
