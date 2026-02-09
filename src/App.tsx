import { useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Sidebar } from "./components/Sidebar";
import { ProjectHeader } from "./components/ProjectHeader";
import { TerminalTabs } from "./components/TerminalTabs";
import { EmptyState } from "./components/EmptyState";
import { WindowControls } from "./components/WindowControls";
import { DiffViewer } from "./components/DiffViewer";
import { ClaudeMdEditor } from "./components/ClaudeMdEditor";
import { NotesEditor } from "./components/NotesEditor";
import { useSessionStore } from "./stores/sessionStore";
import { useSettingsStore } from "./stores/settingsStore";
import { useProjectStore } from "./stores/projectStore";
import { useGitStore } from "./stores/gitStore";
import { killAllSessions, exitApp } from "./lib/pty";
import { applyThemeToDOM, applySyntaxThemeToDOM } from "./lib/themes";
import { useHotkeys } from "./hooks/useHotkeys";
import "./App.css";

function App() {
  const { sessions, activeProjectPath } = useSessionStore();
  const projects = useProjectStore((s) => s.projects);
  const initializedRef = useRef(false);
  useHotkeys();

  // Load settings and projects on startup
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    document.documentElement.classList.add("no-transition");

    Promise.all([
      useSettingsStore.getState().load(),
      useProjectStore.getState().load(),
    ])
      .then(() => {
        useGitStore.getState().initViewModeFromSettings();
      })
      .catch(() => {})
      .finally(() => {
        requestAnimationFrame(() => {
          document.documentElement.classList.remove("no-transition");
        });
      });
  }, []);

  // Apply project theme when active project changes
  useEffect(() => {
    if (!activeProjectPath) {
      const defaultTheme = useSettingsStore.getState().settings.theme;
      applyThemeToDOM(defaultTheme);
      return;
    }
    const project = projects.find((p) => p.path === activeProjectPath);
    if (project?.theme) {
      applyThemeToDOM(project.theme);
    }
  }, [activeProjectPath, projects]);

  // Apply syntax highlighting theme
  const syntaxTheme = useSettingsStore((s) => s.settings.syntaxTheme);
  useEffect(() => {
    applySyntaxThemeToDOM(syntaxTheme);
  }, [syntaxTheme]);

  // Kill all sessions on close
  useEffect(() => {
    const unlisten = getCurrentWindow().onCloseRequested(async (event) => {
      event.preventDefault();
      await killAllSessions().catch(() => {});
      await exitApp().catch(() => {});
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // All unique project paths that have at least one session
  const projectsWithSessions = [
    ...new Set(sessions.map((s) => s.projectPath)),
  ];

  const activeProjectSessions = activeProjectPath
    ? sessions.filter((s) => s.projectPath === activeProjectPath)
    : [];

  return (
    <>
      <div className="app">
        <Sidebar />
        <div className="main-panel">
          {activeProjectPath ? (
            <>
              <ProjectHeader />
              {activeProjectSessions.length === 0 ? (
                <div className="terminal-area">
                  <EmptyState variant="no-sessions" />
                </div>
              ) : null}
            </>
          ) : (
            <>
              <div className="titlebar-fallback" data-tauri-drag-region>
                <WindowControls />
              </div>
              <div className="terminal-area">
                <EmptyState />
              </div>
            </>
          )}
          {/* Render all project terminals simultaneously; only the active one is visible */}
          {projectsWithSessions.map((path) => (
            <div
              key={path}
              className="terminal-grid-wrapper"
              style={{ display: path === activeProjectPath ? "flex" : "none" }}
            >
              <TerminalTabs projectPath={path} />
            </div>
          ))}
        </div>
      </div>
      <DiffViewer />
      <ClaudeMdEditor />
      <NotesEditor />
    </>
  );
}

export default App;
