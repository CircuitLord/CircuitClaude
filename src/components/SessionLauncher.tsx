import { useEffect, useRef, useState } from "react";
import { spawnNewSession } from "../lib/sessions";
import { useSettingsStore } from "../stores/settingsStore";
import { useProjectStore } from "../stores/projectStore";
import { useSessionStore } from "../stores/sessionStore";
import { useAddProject } from "./AddProjectDialog";
import { getSessionTypes } from "../lib/sessionTypes";
import { THEMES, THEME_OPTIONS } from "../lib/themes";
import type { ThemeName } from "../types";

export function SessionLauncher() {
  const activeProjectPath = useSessionStore((s) => s.activeProjectPath);
  const setActiveProject = useSessionStore((s) => s.setActiveProject);
  const projects = useProjectStore((s) => s.projects);
  const removeProject = useProjectStore((s) => s.removeProject);
  const updateProjectTheme = useProjectStore((s) => s.updateProjectTheme);
  const editableSessionTypes = useSettingsStore((s) => s.settings.sessionTypes);
  const sessionTypes = getSessionTypes(editableSessionTypes);
  const handleAdd = useAddProject();

  const [projectOpen, setProjectOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // only arrow keys should scroll, or hovering a clipped row scrolls it under the cursor and loops
  const keyNavRef = useRef(false);

  const project = projects.find((p) => p.path === activeProjectPath) ?? null;
  const accent = THEMES[project?.theme ?? "midnight"]?.accent ?? THEMES.midnight.accent;
  const themeLabel = THEME_OPTIONS.find((o) => o.value === project?.theme)?.label ?? "theme";

  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? projects.filter((p) => p.name.toLowerCase().includes(needle) || p.path.toLowerCase().includes(needle))
    : projects;

  useEffect(() => {
    if (!projectOpen && !themeOpen) return;
    function closeAll() {
      setProjectOpen(false);
      setThemeOpen(false);
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
  }, [projectOpen, themeOpen]);

  // opening starts fresh, with the cursor on the project you're already in
  useEffect(() => {
    if (!projectOpen) return;
    setQuery("");
    const current = projects.findIndex((p) => p.path === activeProjectPath);
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

  function handleSelectTheme(theme: ThemeName) {
    if (project) updateProjectTheme(project.path, theme);
    setThemeOpen(false);
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
      if (picked) handleSelectProject(picked.path);
    }
  }

  const openClass = projectOpen ? " project-open" : themeOpen ? " theme-open" : "";

  return (
    <div className={`session-launcher${openClass}`}>
      <div className="session-launcher-content">
        <div className="session-launcher-ascii">{">"} <span className="session-launcher-cursor">_</span></div>

        <div className="launcher-project" onClick={(e) => e.stopPropagation()}>
          <button
            className="launcher-project-btn"
            aria-expanded={projectOpen}
            onClick={() => { setProjectOpen((v) => !v); setThemeOpen(false); }}
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
                onClick={() => { setProjectOpen(false); handleAdd(); }}
              >
                + add project
              </button>
            </div>
          )}
        </div>

        <div className="launcher-project-meta">
          {project ? (
            <>
              <span className="launcher-project-path" title={project.path}>{project.path}</span>
              <span className="launcher-project-meta-sep">·</span>
              <div className="launcher-theme" onClick={(e) => e.stopPropagation()}>
                <button
                  className="launcher-theme-btn"
                  aria-expanded={themeOpen}
                  title="Project theme"
                  onClick={() => { setThemeOpen((v) => !v); setProjectOpen(false); }}
                >
                  <span className="launcher-theme-swatch" style={{ color: accent }}>#</span>
                  {themeLabel}
                </button>
                {themeOpen && (
                  <div className="launcher-dropdown launcher-dropdown--theme">
                    <div className="launcher-dropdown-list">
                      {THEME_OPTIONS.map((opt) => (
                        <div
                          key={opt.value}
                          className={`launcher-dropdown-row${opt.value === project.theme ? " active" : ""}`}
                        >
                          <button className="launcher-dropdown-option" onClick={() => handleSelectTheme(opt.value)}>
                            <span className="launcher-dropdown-marker">{opt.value === project.theme ? ">" : ""}</span>
                            <span className="launcher-dropdown-swatch" style={{ color: opt.accent }}>#</span>
                            <span className="launcher-dropdown-label">{opt.label}</span>
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
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
    </div>
  );
}
