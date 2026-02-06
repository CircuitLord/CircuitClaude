import { useSessionStore, generateTabId } from "../stores/sessionStore";
import { useProjectStore } from "../stores/projectStore";

export function spawnNewSession() {
  const { activeProjectPath, addSession } = useSessionStore.getState();
  const { projects } = useProjectStore.getState();
  if (!activeProjectPath) return;
  const project = projects.find((p) => p.path === activeProjectPath);
  const name = project?.name ?? activeProjectPath.split(/[/\\]/).pop() ?? "Unknown";
  addSession({
    id: generateTabId(),
    projectName: name,
    projectPath: activeProjectPath,
    sessionId: null,
    claudeSessionId: crypto.randomUUID(),
    createdAt: Date.now(),
    restored: false,
  });
}

/** Get or create the single shell session for the active project, and activate it. */
export function activateShellSession() {
  const { sessions, activeProjectPath, addSession, setActiveSession } = useSessionStore.getState();
  if (!activeProjectPath) return;

  const existing = sessions.find((s) => s.projectPath === activeProjectPath && s.isShell);
  if (existing) {
    setActiveSession(existing.id);
  } else {
    addSession({
      id: generateTabId(),
      projectName: "terminal",
      projectPath: activeProjectPath,
      sessionId: null,
      createdAt: Date.now(),
      restored: false,
      isShell: true,
    });
  }
}
