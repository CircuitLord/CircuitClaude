import { useSessionStore, generateTabId } from "../stores/sessionStore";
import { useProjectStore } from "../stores/projectStore";
import type { SessionType } from "../types";

export function spawnNewSession(type: SessionType = "claude", targetPane?: 1 | 2) {
  const { activeProjectPath, addSession, projectSplits, setFocusedPane } = useSessionStore.getState();
  const { projects } = useProjectStore.getState();
  if (!activeProjectPath) return;

  // If a targetPane is specified and a split exists, focus that pane first
  // so addSession routes the new session to it
  if (targetPane !== undefined) {
    const split = projectSplits.get(activeProjectPath);
    if (split) {
      setFocusedPane(activeProjectPath, targetPane);
    }
  }

  const project = projects.find((p) => p.path === activeProjectPath);
  const name = project?.name ?? activeProjectPath.split(/[/\\]/).pop() ?? "Unknown";
  addSession({
    id: generateTabId(),
    projectName: name,
    projectPath: activeProjectPath,
    sessionId: null,
    createdAt: Date.now(),
    sessionType: type,
  });
}
