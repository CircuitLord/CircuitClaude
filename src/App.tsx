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
import { loadSessionsConfig, saveSessionsConfig, saveScrollback } from "./lib/config";
import { killAllSessions, exitApp } from "./lib/pty";
import { serializeAllTerminals } from "./lib/terminalRegistry";
import { spawnNewSession } from "./lib/sessions";
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
  const layoutMode = useSettingsStore((s) => s.settings.layoutMode);
  const restoredRef = useRef(false);
  useHotkeys();

  // Restore sessions on startup (once, after projects are loaded)
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;

    useSettingsStore.getState().load();

    loadSessionsConfig()
      .then((config) => {
        if (config && config.layouts.length > 0) {
          useSessionStore.getState().restoreFromConfig(config);
        }
      })
      .catch(() => {});
  }, []);

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
