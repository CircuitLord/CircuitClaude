import { useSessionStore, generateTabId } from "../stores/sessionStore";
import { useProjectStore } from "../stores/projectStore";
import { useEditorStore } from "../stores/editorStore";
import { closePtySession } from "./pty";
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

/** Open a file as an editor tab. If already open for this project, focuses it instead. */
export function openFileTab(filePath: string, fileName: string) {
  const { sessions, activeProjectPath, addSession, setActiveSession } = useSessionStore.getState();
  if (!activeProjectPath) return;

  // Check if file is already open in a tab for this project
  const existing = sessions.find(
    (s) => s.projectPath === activeProjectPath && s.sessionType === "editor" && s.filePath === filePath,
  );
  if (existing) {
    setActiveSession(existing.id);
    return;
  }

  const { projects } = useProjectStore.getState();
  const project = projects.find((p) => p.path === activeProjectPath);
  const name = project?.name ?? activeProjectPath.split(/[/\\]/).pop() ?? "Unknown";

  addSession({
    id: generateTabId(),
    projectName: name,
    projectPath: activeProjectPath,
    sessionId: null,
    createdAt: Date.now(),
    sessionType: "editor",
    filePath,
    fileName,
  });
}

/** Close a tab — handles both editor and terminal sessions. */
export function closeTab(tabId: string) {
  const state = useSessionStore.getState();
  const session = state.sessions.find((s) => s.id === tabId);
  if (!session) return;

  if (session.sessionType === "editor") {
    useEditorStore.getState().closeFile(tabId);
  } else if (session.sessionId) {
    closePtySession(session.sessionId).catch(() => {});
  }

  state.removeSession(tabId);
}
