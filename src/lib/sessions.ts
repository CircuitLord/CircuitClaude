import { useSessionStore, generateTabId } from "../stores/sessionStore";
import { useProjectStore } from "../stores/projectStore";
import type { SessionType } from "../types";

export function spawnNewSession(type: SessionType = "claude") {
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
    createdAt: Date.now(),
    sessionType: type,
  });
}

