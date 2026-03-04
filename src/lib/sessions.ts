import { useSessionStore, generateTabId } from "../stores/sessionStore";
import { useProjectStore } from "../stores/projectStore";
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

/** Open a file as an editor tab. If already open for this project, focuses it instead.
 *  @param preview - if true (default), opens as a preview tab that gets replaced by subsequent opens */
export function openFileTab(filePath: string, fileName: string, preview = true) {
  const { sessions, activeProjectPath, addSession, setActiveSession, updateSession, projectSplits } = useSessionStore.getState();
  if (!activeProjectPath) return;

  // Check if file is already open in a tab for this project
  const existing = sessions.find(
    (s) => s.projectPath === activeProjectPath && s.sessionType === "editor" && s.filePath === filePath,
  );
  if (existing) {
    setActiveSession(existing.id);
    // If opening permanently and existing is preview, promote it
    if (!preview && existing.isPreview) {
      updateSession(existing.id, { isPreview: false });
    }
    return;
  }

  // If opening as preview, close any existing preview tab in the current pane
  if (preview) {
    const split = projectSplits.get(activeProjectPath);
    let paneSessionIds: string[] | null = null;

    if (split) {
      // Find which pane is focused and get its session IDs
      const focusedPane = split.focusedPane === 1 ? split.pane1 : split.pane2;
      paneSessionIds = focusedPane.sessionIds;
    }

    const projectSessions = sessions.filter((s) => s.projectPath === activeProjectPath);
    const candidateSessions = paneSessionIds
      ? projectSessions.filter((s) => paneSessionIds!.includes(s.id))
      : projectSessions;

    const existingPreview = candidateSessions.find((s) => s.isPreview);
    if (existingPreview) {
      closeTab(existingPreview.id);
    }
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
    isPreview: preview,
  });
}

/** Promote a preview tab to a permanent tab. */
export function pinTab(tabId: string) {
  const { sessions, updateSession } = useSessionStore.getState();
  const session = sessions.find((s) => s.id === tabId);
  if (session?.isPreview) {
    updateSession(tabId, { isPreview: false });
  }
}

/** Close a tab — handles both editor and terminal sessions. */
export function closeTab(tabId: string) {
  const state = useSessionStore.getState();
  const session = state.sessions.find((s) => s.id === tabId);
  if (!session) return;

  if (session.sessionType !== "editor" && session.sessionId) {
    closePtySession(session.sessionId).catch(() => {});
  }

  state.removeSession(tabId);
}
