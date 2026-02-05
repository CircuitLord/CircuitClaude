import { useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Sidebar } from "./components/Sidebar";
import { ProjectHeader } from "./components/ProjectHeader";
import { TerminalGrid } from "./components/TerminalGrid";
import { TerminalTabs } from "./components/TerminalTabs";
import { EmptyState } from "./components/EmptyState";
import { WindowControls } from "./components/WindowControls";
import { DiffViewer } from "./components/DiffViewer";
import { useSessionStore } from "./stores/sessionStore";
import { useSettingsStore } from "./stores/settingsStore";
import { useProjectStore } from "./stores/projectStore";
import { loadSessionsConfig, saveSessionsConfig, saveScrollback } from "./lib/config";
import { killAllSessions, exitApp } from "./lib/pty";
import { serializeAllTerminals } from "./lib/terminalRegistry";
import { spawnNewSession } from "./lib/sessions";
import { applyThemeToDOM, applySyntaxThemeToDOM } from "./lib/themes";
import { useHotkeys } from "./hooks/useHotkeys";
import "./App.css";

async function saveAllSessionData() {
  const config = useSessionStore.getState().toSessionsConfig();
  const buffers = serializeAllTerminals();

  // Save scrollback files in parallel, then save config
  const scrollbackPromises = Array.from(buffers.entries()).map(
    ([tabId, data]) => saveScrollback(tabId, data).catch(() => {})
  );
  await Promise.all(scrollbackPromises);
  await saveSessionsConfig(config).catch(() => {});
}

function App() {
  const { sessions, activeProjectPath } = useSessionStore();
  const projects = useProjectStore((s) => s.projects);
  const layoutMode = useSettingsStore((s) => s.settings.layoutMode);
  const restoredRef = useRef(false);
  useHotkeys();

  // Restore sessions on startup (once, after projects are loaded)
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;

    // Prevent animation flash on first paint
    document.documentElement.classList.add("no-transition");

    Promise.all([
      useSettingsStore.getState().load(),
      useProjectStore.getState().load(),
    ])
      .then(() => loadSessionsConfig())
      .then((config) => {
        if (config && config.layouts.length > 0) {
          useSessionStore.getState().restoreFromConfig(config);
        }
      })
      .catch(() => {})
      .finally(() => {
        // Remove no-transition guard after first theme is applied
        requestAnimationFrame(() => {
          document.documentElement.classList.remove("no-transition");
        });
      });
  }, []);

  // Apply project theme when active project changes
  useEffect(() => {
    if (!activeProjectPath) {
      // No project selected — apply default theme from settings
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

  // Save on close + auto-save every 30s
  useEffect(() => {
    // Intercept window close
    const unlisten = getCurrentWindow().onCloseRequested(async (event) => {
      event.preventDefault();
      await saveAllSessionData();
      await killAllSessions().catch(() => {});
      await exitApp().catch(() => {});
    });

    // Auto-save interval
    const interval = setInterval(() => {
      saveAllSessionData();
    }, 30_000);

    return () => {
      clearInterval(interval);
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

  function handleSpawnForProject() {
    spawnNewSession();
  }

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
                  <EmptyState
                    variant="no-sessions"
                    onSpawn={handleSpawnForProject}
                  />
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
              {layoutMode === "tabs" ? (
                <TerminalTabs projectPath={path} />
              ) : (
                <TerminalGrid projectPath={path} />
              )}
            </div>
          ))}
        </div>
      </div>
      <DiffViewer />
    </>
  );
}

export default App;
