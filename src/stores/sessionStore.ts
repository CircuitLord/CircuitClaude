import { create } from "zustand";
import { TerminalSession, TabStatus, SplitState, PaneState, PersistedSessionState } from "../types";
import { useEditorStore } from "./editorStore";
import { loadWorkspaceSessions, saveWorkspaceSessions } from "../lib/config";

interface SessionStore {
  sessions: TerminalSession[];
  loaded: boolean;
  activeSessionId: string | null;
  activeProjectPath: string | null;
  tabStatuses: Map<string, TabStatus>;
  sessionTitles: Map<string, string>;
  bottomTerminalProjects: Set<string>;
  toggleBottomTerminal: (projectPath: string) => void;
  load: (projectPaths: string[]) => Promise<void>;
  flush: () => Promise<void>;
  addSession: (session: TerminalSession, position: "start" | "end") => void;
  removeSession: (id: string) => void;
  removeProjectSessions: (projectPath: string) => void;
  setActiveSession: (id: string | null) => void;
  /** Switching project always lands on the new-session launcher, not a remembered tab */
  setActiveProject: (path: string | null) => void;
  /** Focus a session from anywhere, switching project first if needed */
  activateSession: (id: string) => void;
  updateSessionPtyId: (id: string, sessionId: string) => void;
  setTabStatus: (tabId: string, status: TabStatus | null) => void;
  setSessionTitle: (tabId: string, title: string) => void;
  updateSession: (id: string, partial: Partial<Pick<TerminalSession, "isPreview" | "hasStarted">>) => void;
  reorderSessions: (projectPath: string, fromIndex: number, toIndex: number) => void;
  projectSplits: Map<string, SplitState>;
  setSplit: (projectPath: string, split: SplitState) => void;
  clearSplit: (projectPath: string) => void;
  setFocusedPane: (projectPath: string, pane: 1 | 2) => void;
  moveSessionToPane: (projectPath: string, sessionId: string, targetPane: 1 | 2, insertIndex?: number) => void;
  reorderPaneSessions: (projectPath: string, pane: 1 | 2, fromIndex: number, toIndex: number) => void;
}

export function generateTabId(): string {
  return crypto.randomUUID();
}

/** Find which pane contains a session, or null if not in split */
function findPane(split: SplitState, sessionId: string): 1 | 2 | null {
  if (split.pane1.sessionIds.includes(sessionId)) return 1;
  if (split.pane2.sessionIds.includes(sessionId)) return 2;
  return null;
}

function getPaneState(split: SplitState, pane: 1 | 2): PaneState {
  return pane === 1 ? split.pane1 : split.pane2;
}

function withUpdatedPane(split: SplitState, pane: 1 | 2, newPane: PaneState): SplitState {
  return pane === 1 ? { ...split, pane1: newPane } : { ...split, pane2: newPane };
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
let persistChain = Promise.resolve();
let lastPersistedKey = "";

function enqueuePersistence(state: PersistedSessionState): Promise<void> {
  persistChain = persistChain.then(() => saveWorkspaceSessions(state)).catch(() => {});
  return persistChain;
}

function buildPersistedState(state: SessionStore): PersistedSessionState {
  const sessions = state.sessions
    .filter((session) => session.sessionType !== "editor")
    .map(({ id, projectName, projectPath, agentSessionId, hasStarted, createdAt, sessionType }) => ({
      id,
      projectName,
      projectPath,
      agentSessionId,
      hasStarted,
      createdAt,
      sessionType,
    }));
  const sessionIds = new Set(sessions.map((session) => session.id));
  const sessionTitles = Object.fromEntries(
    [...state.sessionTitles].filter(([id]) => sessionIds.has(id)),
  );
  return { sessions, sessionTitles };
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  sessions: [],
  loaded: false,
  activeSessionId: null,
  activeProjectPath: null,
  tabStatuses: new Map(),
  sessionTitles: new Map(),
  projectSplits: new Map(),
  bottomTerminalProjects: new Set(),

  // per-project docked terminal, in-memory so it resets on restart
  toggleBottomTerminal: (projectPath) =>
    set((state) => {
      const next = new Set(state.bottomTerminalProjects);
      if (next.has(projectPath)) {
        next.delete(projectPath);
      } else {
        next.add(projectPath);
      }
      return { bottomTerminalProjects: next };
    }),

  load: async (projectPaths) => {
    const persisted = await loadWorkspaceSessions();
    const validProjects = new Set(projectPaths);
    const sessions = persisted.sessions
      .filter((session) => validProjects.has(session.projectPath))
      .map((session) => ({
        ...session,
        sessionId: null,
        isDormant: true,
        resumeSession: session.hasStarted === true,
      }));
    const sessionIds = new Set(sessions.map((session) => session.id));
    const sessionTitles = new Map(
      Object.entries(persisted.sessionTitles).filter(([id]) => sessionIds.has(id)),
    );
    lastPersistedKey = JSON.stringify(persisted);
    set({ sessions, sessionTitles, loaded: true });
  },

  flush: async () => {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    const persisted = buildPersistedState(get());
    lastPersistedKey = JSON.stringify(persisted);
    await enqueuePersistence(persisted);
  },

  addSession: (session, position) =>
    set((state) => {
      const projectSplits = new Map(state.projectSplits);
      const split = projectSplits.get(session.projectPath);

      if (split) {
        // Add new session to the focused pane
        const pane = getPaneState(split, split.focusedPane);
        const newPane: PaneState = {
          sessionIds: position === "start" ? [session.id, ...pane.sessionIds] : [...pane.sessionIds, session.id],
          activeSessionId: session.id,
        };
        projectSplits.set(session.projectPath, withUpdatedPane(split, split.focusedPane, newPane));
      }

      const sessions = [...state.sessions];
      if (position === "start") {
        const firstProjectSessionIndex = sessions.findIndex((existing) => existing.projectPath === session.projectPath);
        sessions.splice(firstProjectSessionIndex === -1 ? sessions.length : firstProjectSessionIndex, 0, session);
      } else {
        sessions.push(session);
      }

      return {
        sessions,
        activeSessionId: session.id,
        activeProjectPath: session.projectPath,
        projectSplits,
      };
    }),

  removeSession: (id) =>
    set((state) => {
      const removed = state.sessions.find((s) => s.id === id);
      // Clean up editor store if this was an editor tab
      if (removed?.sessionType === "editor") {
        useEditorStore.getState().closeFile(id);
      }
      const sessions = state.sessions.filter((s) => s.id !== id);
      let activeSessionId = state.activeSessionId;

      const projectSplits = new Map(state.projectSplits);
      if (removed) {
        const split = projectSplits.get(removed.projectPath);
        if (split) {
          const paneNum = findPane(split, id);
          if (paneNum) {
            const pane = getPaneState(split, paneNum);
            const newSessionIds = pane.sessionIds.filter((sid) => sid !== id);

            if (newSessionIds.length === 0) {
              // Pane is empty — collapse split, merge other pane's sessions back
              const otherPane = getPaneState(split, paneNum === 1 ? 2 : 1);
              projectSplits.delete(removed.projectPath);
              activeSessionId = otherPane.activeSessionId;
            } else {
              // Update the pane
              let newActiveId = pane.activeSessionId;
              if (newActiveId === id) {
                // Pick adjacent tab
                const oldIdx = pane.sessionIds.indexOf(id);
                newActiveId = newSessionIds[Math.min(oldIdx, newSessionIds.length - 1)];
              }
              const newPane: PaneState = { sessionIds: newSessionIds, activeSessionId: newActiveId };
              const newSplit = withUpdatedPane(split, paneNum, newPane);
              projectSplits.set(removed.projectPath, newSplit);

              // Update global active to the focused pane's active
              const focusedPane = getPaneState(newSplit, newSplit.focusedPane);
              activeSessionId = focusedPane.activeSessionId;
            }
          }
        }
      }

      if (activeSessionId === id) {
        if (removed) {
          const sameProjectBeforeRemoval = state.sessions.filter((s) => s.projectPath === removed.projectPath);
          const removedProjectIndex = sameProjectBeforeRemoval.findIndex((s) => s.id === id);
          const fallback =
            sameProjectBeforeRemoval[removedProjectIndex - 1]
            ?? sameProjectBeforeRemoval[removedProjectIndex + 1]
            ?? null;
          activeSessionId = fallback?.id ?? null;
        } else {
          activeSessionId = null;
        }
      }

      const tabStatuses = new Map(state.tabStatuses);
      tabStatuses.delete(id);
      const sessionTitles = new Map(state.sessionTitles);
      sessionTitles.delete(id);

      return {
        sessions,
        activeSessionId,
        activeProjectPath: state.activeProjectPath,
        tabStatuses,
        sessionTitles,
        projectSplits,
      };
    }),

  removeProjectSessions: (projectPath) =>
    set((state) => {
      const sessions = state.sessions.filter(
        (s) => s.projectPath !== projectPath
      );
      const activeSessionId =
        state.activeSessionId &&
        state.sessions.find((s) => s.id === state.activeSessionId)
          ?.projectPath === projectPath
          ? sessions.length > 0
            ? sessions[sessions.length - 1].id
            : null
          : state.activeSessionId;
      const activeProjectPath =
        state.activeProjectPath === projectPath
          ? null
          : state.activeProjectPath;
      const projectSplits = new Map(state.projectSplits);
      projectSplits.delete(projectPath);
      const removedIds = new Set(
        state.sessions
          .filter((s) => s.projectPath === projectPath)
          .map((s) => s.id)
      );
      const tabStatuses = new Map(state.tabStatuses);
      const sessionTitles = new Map(state.sessionTitles);
      for (const id of removedIds) {
        tabStatuses.delete(id);
        sessionTitles.delete(id);
      }
      return {
        sessions,
        activeSessionId,
        activeProjectPath,
        projectSplits,
        tabStatuses,
        sessionTitles,
      };
    }),

  setActiveSession: (id) => {
    const state = get();
    if (!id) {
      set({ activeSessionId: id });
      return;
    }

    const session = state.sessions.find((candidate) => candidate.id === id);
    if (session?.isDormant) {
      set({
        sessions: state.sessions.map((candidate) => candidate.id === id ? { ...candidate, isDormant: false } : candidate),
      });
    }

    if (state.activeProjectPath) {
      const split = state.projectSplits.get(state.activeProjectPath);
      if (split) {
        // Find which pane contains this session
        const paneNum = findPane(split, id);
        if (paneNum) {
          // Session is in a pane — set it as that pane's active and focus that pane
          const nextSplits = new Map(state.projectSplits);
          const pane = getPaneState(split, paneNum);
          const newPane: PaneState = { ...pane, activeSessionId: id };
          const newSplit = withUpdatedPane({ ...split, focusedPane: paneNum as 1 | 2 }, paneNum, newPane);
          nextSplits.set(state.activeProjectPath, newSplit);
          set({ activeSessionId: id, projectSplits: nextSplits });
          return;
        }
        // Session not in any pane (shouldn't normally happen in split mode)
        // Fall through to non-split behavior
      }
    }

    set({ activeSessionId: id });
  },

  setActiveProject: (path) => set({ activeProjectPath: path, activeSessionId: null }),

  activateSession: (id) => {
    const state = get();
    const session = state.sessions.find((s) => s.id === id);
    if (!session) return;
    if (session.isDormant) {
      set((current) => ({
        sessions: current.sessions.map((candidate) => candidate.id === id ? { ...candidate, isDormant: false } : candidate),
      }));
    }
    if (state.activeProjectPath !== session.projectPath) {
      get().setActiveProject(session.projectPath);
    }
    get().setActiveSession(id);
  },

  updateSessionPtyId: (id, sessionId) =>
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === id ? { ...s, sessionId } : s
      ),
    })),

  updateSession: (id, partial) =>
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === id ? { ...s, ...partial } : s
      ),
    })),

  setTabStatus: (tabId, status) => {
    const current = get().tabStatuses.get(tabId) ?? null;
    if (current === status) return;
    set((state) => {
      const next = new Map(state.tabStatuses);
      if (status === null) {
        next.delete(tabId);
      } else {
        next.set(tabId, status);
      }
      return { tabStatuses: next };
    });
  },

  setSessionTitle: (tabId, title) =>
    set((state) => {
      const next = new Map(state.sessionTitles);
      next.set(tabId, title);
      return { sessionTitles: next };
    }),

  reorderSessions: (projectPath, fromIndex, toIndex) =>
    set((state) => {
      if (fromIndex === toIndex) return {};
      const projectSessions = state.sessions.filter((s) => s.projectPath === projectPath);
      if (fromIndex < 0 || fromIndex >= projectSessions.length || toIndex < 0 || toIndex >= projectSessions.length) return {};

      const [moved] = projectSessions.splice(fromIndex, 1);
      projectSessions.splice(toIndex, 0, moved);

      const reorderedIds = new Set(projectSessions.map((s) => s.id));
      const otherSessions = state.sessions.filter((s) => !reorderedIds.has(s.id));

      // Re-insert project sessions at the position of the first original occurrence
      const firstOriginalIndex = state.sessions.findIndex((s) => s.projectPath === projectPath);
      const sessions = [
        ...otherSessions.slice(0, firstOriginalIndex),
        ...projectSessions,
        ...otherSessions.slice(firstOriginalIndex),
      ];

      return { sessions };
    }),

  setSplit: (projectPath, split) =>
    set((state) => {
      const next = new Map(state.projectSplits);
      next.set(projectPath, split);
      return { projectSplits: next };
    }),

  clearSplit: (projectPath) =>
    set((state) => {
      const split = state.projectSplits.get(projectPath);
      if (!split) return {};
      const next = new Map(state.projectSplits);
      next.delete(projectPath);
      // Set the focused pane's active session as the global active
      const focusedPane = getPaneState(split, split.focusedPane);
      const activeSessionId = focusedPane.activeSessionId;
      return { projectSplits: next, activeSessionId };
    }),

  setFocusedPane: (projectPath, pane) =>
    set((state) => {
      const split = state.projectSplits.get(projectPath);
      if (!split || split.focusedPane === pane) return {};
      const next = new Map(state.projectSplits);
      const newSplit = { ...split, focusedPane: pane };
      next.set(projectPath, newSplit);
      const activeSessionId = getPaneState(newSplit, pane).activeSessionId;
      return { projectSplits: next, activeSessionId };
    }),

  moveSessionToPane: (projectPath, sessionId, targetPane, insertIndex?) =>
    set((state) => {
      const split = state.projectSplits.get(projectPath);
      if (!split) return {};

      const sourcePane = findPane(split, sessionId);
      if (!sourcePane || sourcePane === targetPane) return {};

      const source = getPaneState(split, sourcePane);
      const target = getPaneState(split, targetPane);

      // Remove from source
      const newSourceIds = source.sessionIds.filter((id) => id !== sessionId);
      // Add to target
      const newTargetIds = [...target.sessionIds];
      if (insertIndex !== undefined && insertIndex >= 0 && insertIndex <= newTargetIds.length) {
        newTargetIds.splice(insertIndex, 0, sessionId);
      } else {
        newTargetIds.push(sessionId);
      }

      const projectSplits = new Map(state.projectSplits);

      if (newSourceIds.length === 0) {
        // Source pane is empty — collapse split
        projectSplits.delete(projectPath);
        return { projectSplits, activeSessionId: sessionId };
      }

      // Update source pane's active if we moved the active session
      let newSourceActive = source.activeSessionId;
      if (newSourceActive === sessionId) {
        const oldIdx = source.sessionIds.indexOf(sessionId);
        newSourceActive = newSourceIds[Math.min(oldIdx, newSourceIds.length - 1)];
      }

      const newSource: PaneState = { sessionIds: newSourceIds, activeSessionId: newSourceActive };
      const newTarget: PaneState = { sessionIds: newTargetIds, activeSessionId: sessionId };

      const base = { ...split, focusedPane: targetPane };
      const newSplit = sourcePane === 1
        ? { ...base, pane1: newSource, pane2: newTarget }
        : { ...base, pane1: newTarget, pane2: newSource };

      projectSplits.set(projectPath, newSplit);
      return { projectSplits, activeSessionId: sessionId };
    }),

  reorderPaneSessions: (projectPath, pane, fromIndex, toIndex) =>
    set((state) => {
      if (fromIndex === toIndex) return {};
      const split = state.projectSplits.get(projectPath);
      if (!split) return {};

      const paneState = getPaneState(split, pane);
      if (fromIndex < 0 || fromIndex >= paneState.sessionIds.length || toIndex < 0 || toIndex >= paneState.sessionIds.length) return {};

      const newIds = [...paneState.sessionIds];
      const [moved] = newIds.splice(fromIndex, 1);
      newIds.splice(toIndex, 0, moved);

      const newPane: PaneState = { ...paneState, sessionIds: newIds };
      const projectSplits = new Map(state.projectSplits);
      projectSplits.set(projectPath, withUpdatedPane(split, pane, newPane));
      return { projectSplits };
    }),
}));

useSessionStore.subscribe((state) => {
  if (!state.loaded) return;
  const persisted = buildPersistedState(state);
  const key = JSON.stringify(persisted);
  if (key === lastPersistedKey) return;
  lastPersistedKey = key;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void enqueuePersistence(persisted);
  }, 150);
});
