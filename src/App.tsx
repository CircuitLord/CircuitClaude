import { useEffect, useLayoutEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Sidebar } from "./components/Sidebar";
import { ProjectHeader } from "./components/ProjectHeader";
import { TerminalTabs } from "./components/TerminalTabs";
import { EmptyState } from "./components/EmptyState";
import { SessionLauncher } from "./components/SessionLauncher";
import { WindowControls } from "./components/WindowControls";
import { DiffViewer } from "./components/DiffViewer";
import { CommandPalette } from "./components/CommandPalette";
import { RightPanel } from "./components/RightPanel";
import { BottomTerminal } from "./components/BottomTerminal";
import { useSessionStore } from "./stores/sessionStore";
import { useNotesStore } from "./stores/notesStore";
import { useSettingsStore } from "./stores/settingsStore";
import { useProjectStore } from "./stores/projectStore";
import { useGitStore } from "./stores/gitStore";
import { usePinnedFilesStore } from "./stores/pinnedFilesStore";
import { applyThemeToDOM, applySyntaxThemeToDOM } from "./lib/themes";
import { useHotkeys } from "./hooks/useHotkeys";
import { useUpdateCheck } from "./hooks/useUpdateCheck";
import { useGitPolling } from "./hooks/useGitPolling";
import "./App.css";

function App() {
  const { sessions, activeProjectPath, activeSessionId } = useSessionStore();
  const projects = useProjectStore((s) => s.projects);
  const initializedRef = useRef(false);
  const { status: updateStatus, updateInfo, install: installUpdate, dismiss: dismissUpdate } = useUpdateCheck();
  useHotkeys();
  useGitPolling();

  // Load settings and projects on startup
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    document.documentElement.classList.add("no-transition");

    Promise.all([
      useSettingsStore.getState().load(),
      useProjectStore.getState().load(),
      usePinnedFilesStore.getState().load(),
    ])
      .then(async () => {
        useGitStore.getState().initViewModeFromSettings();
        const paths = useProjectStore.getState().projects.map((p) => p.path);
        await useSessionStore.getState().load(paths);
        // Preload notes for all projects so switching is instant
        useNotesStore.getState().preloadAll(paths);
      })
      .catch(() => {})
      .finally(() => {
        requestAnimationFrame(() => {
          document.documentElement.classList.remove("no-transition");
        });
      });
  }, []);

  // Apply project theme before paint so a switch never shows the old accent
  const themedProjectPathRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    // instant on a project switch, animated when the current project's theme is edited
    const instant = themedProjectPathRef.current !== activeProjectPath;
    themedProjectPathRef.current = activeProjectPath;

    if (!activeProjectPath) {
      applyThemeToDOM(useSettingsStore.getState().settings.theme, instant);
      return;
    }
    const project = projects.find((p) => p.path === activeProjectPath);
    if (project?.theme) {
      applyThemeToDOM(project.theme, instant);
    }
  }, [activeProjectPath, projects]);

  // Apply syntax highlighting theme
  const syntaxTheme = useSettingsStore((s) => s.settings.syntaxTheme);
  useEffect(() => {
    applySyntaxThemeToDOM(syntaxTheme);
  }, [syntaxTheme]);

  // Flush notes before closing this window.
  useEffect(() => {
    let closing = false;
    const window = getCurrentWindow();
    const unlisten = window.onCloseRequested(async (event) => {
      if (closing) return;
      event.preventDefault();
      closing = true;
      // Give flush up to 2s, then force-close regardless
      await Promise.race([
        Promise.all([
          useNotesStore.getState().flush(),
          useSessionStore.getState().flush(),
        ]),
        new Promise((r) => setTimeout(r, 2000)),
      ]);
      // destroy() bypasses onCloseRequested, avoiding re-entry
      await window.destroy();
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

  // no tab selected (freshly switched project, or none exist) shows the launcher
  const showLauncher = !!activeProjectPath && !activeProjectSessions.some((s) => s.id === activeSessionId);

  return (
    <>
      <div className="app">
        <Sidebar />
        <div className="main-panel">
          {updateStatus === "available" && updateInfo && (
            <div className="update-banner">
              <span className="update-banner-text">
                update available: {updateInfo.version}
              </span>
              <div className="update-banner-actions">
                <button className="update-banner-action" onClick={dismissUpdate}>
                  :dismiss
                </button>
                <button className="update-banner-action update-banner-action--primary" onClick={installUpdate}>
                  :install
                </button>
              </div>
            </div>
          )}
          {updateStatus === "downloading" && (
            <div className="update-banner">
              <span className="update-banner-text">installing update...</span>
            </div>
          )}
          {activeProjectPath ? (
            <ProjectHeader />
          ) : (
            <div className="titlebar-fallback" data-tauri-drag-region>
              <WindowControls />
            </div>
          )}
          <div className="main-content-area">
            <div className="terminal-content">
              {activeProjectPath ? (
                showLauncher ? (
                  <div className="terminal-area">
                    <SessionLauncher projectPath={activeProjectPath} />
                  </div>
                ) : null
              ) : (
                <div className="terminal-area">
                  <EmptyState />
                </div>
              )}
              {/* Render all project terminals simultaneously; only the active one is visible */}
              {projectsWithSessions.map((path) => (
                <div
                  key={path}
                  className="terminal-grid-wrapper"
                  data-project={path}
                  style={{ display: path === activeProjectPath && !showLauncher ? "flex" : "none" }}
                >
                  <TerminalTabs projectPath={path} />
                </div>
              ))}
              <BottomTerminal />
            </div>
            {activeProjectPath && <RightPanel />}
          </div>
        </div>
      </div>
      <DiffViewer />
      <CommandPalette />
    </>
  );
}

export default App;
