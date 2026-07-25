import { create } from "zustand";
import { TerminalSession, TabStatus, SplitState, PaneState, PersistedSession, PersistedSessionState } from "../types";
import { useEditorStore } from "./editorStore";
import { loadWorkspaceSessions, saveWorkspaceSessions } from "../lib/config";

interface SessionStore {
  sessions: TerminalSession[];
  archivedSessions: TerminalSession[];
  loaded: boolean;
  activeSessionId: string | null;
  activeProjectPath: string | null;
  tabStatuses: Map<string, TabStatus>;
  sessionTitles: Map<string, string>;
  lastActivity: Map<string, number>;
  bottomTerminalProjects: Set<string>;
  toggleBottomTerminal: (projectPath: string) => void;
  load: (projectPaths: string[]) => Promise<void>;
  flush: () => Promise<void>;
  addSession: (session: TerminalSession, position: "start" | "end") => void;
  removeSession: (id: string) => void;
  /** drop a session out of the active list but keep it recoverable */
  archiveSession: (id: string) => void;
  /** put an archived session back at the top of the active list, dormant */
  restoreSession: (id: string) => void;
  removeProjectSessions: (projectPath: string) => void;
  setActiveSession: (id: string | null) => void;
  /** Switching project always lands on the new-session launcher, not a remembered tab */
  setActiveProject: (path: string | null) => void;
  /** Focus a session from anywhere, switching project first if needed */
  activateSession: (id: string) => void;
  updateSessionPtyId: (id: string, sessionId: string) => void;
  setTabStatus: (tabId: string, status: TabStatus | null) => void;
  setSessionTitle: (tabId: string, title: string) => void;
  /** stamp a session as interacted with, throttled so streaming output doesn't thrash the store */
  touchSession: (id: string) => void;
  updateSession: (id: string, partial: Partial<Pick<TerminalSession, "isPreview" | "hasStarted">>) => void;
  /** reorder within the flat cross-project session list */
  moveSession: (fromIndex: number, toIndex: number) => void;
  projectSplits: Map<string, SplitState>;
  setSplit: (projectPath: string, split: SplitState) => void;
  clearSplit: (projectPath: string) => void;
  setFocusedPane: (projectPath: string, pane: 1 | 2) => void;
  moveSessionToPane: (projectPath: string, sessionId: string, targetPane: 1 | 2, insertIndex?: number) => void;
}

const TOUCH_THROTTLE_MS = 15_000;
const MAX_ARCHIVED = 10;

export function generateTabId(): string {
  return crypto.randomUUID();
}

/** Find which pane contains a session, or null if not in split */
export function findPane(split: SplitState, sessionId: string): 1 | 2 | null {
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

function toPersistedSession({ id, projectName, projectPath, agentSessionId, hasStarted, createdAt, sessionType }: TerminalSession): PersistedSession {
  return { id, projectName, projectPath, agentSessionId, hasStarted, createdAt, sessionType };
}

/** restored from disk or from the archive: no pty yet, resume only if it ever ran */
function toDormantSession(session: PersistedSession): TerminalSession {
  return { ...session, sessionId: null, isDormant: true, resumeSession: session.hasStarted === true };
}

function buildPersistedState(state: SessionStore): PersistedSessionState {
  const sessions = state.sessions
    .filter((session) => session.sessionType !== "editor")
    .map(toPersistedSession);
  const archivedSessions = state.archivedSessions.map(toPersistedSession);
  const known = new Set([...sessions, ...archivedSessions].map((session) => session.id));
  const sessionTitles = Object.fromEntries(
    [...state.sessionTitles].filter(([id]) => known.has(id)),
  );
  const lastActivity = Object.fromEntries(
    [...state.lastActivity].filter(([id]) => known.has(id)),
  );
  return { sessions, archivedSessions, sessionTitles, lastActivity, activeProjectPath: state.activeProjectPath };
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  sessions: [],
  archivedSessions: [],
  loaded: false,
  activeSessionId: null,
  activeProjectPath: null,
  tabStatuses: new Map(),
  sessionTitles: new Map(),
  lastActivity: new Map(),
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
      .map(toDormantSession);
    const archivedSessions = (persisted.archivedSessions ?? [])
      .filter((session) => validProjects.has(session.projectPath))
      .slice(0, MAX_ARCHIVED)
      .map(toDormantSession);
    const known = new Set([...sessions, ...archivedSessions].map((session) => session.id));
    const sessionTitles = new Map(
      Object.entries(persisted.sessionTitles).filter(([id]) => known.has(id)),
    );
    const lastActivity = new Map(
      Object.entries(persisted.lastActivity ?? {}).filter(([id]) => known.has(id)),
    );
    for (const session of [...sessions, ...archivedSessions]) {
      if (!lastActivity.has(session.id)) lastActivity.set(session.id, session.createdAt);
    }
    const activeProjectPath = persisted.activeProjectPath && validProjects.has(persisted.activeProjectPath)
      ? persisted.activeProjectPath
      : projectPaths[0] ?? null;
    set({ sessions, archivedSessions, sessionTitles, lastActivity, activeProjectPath, loaded: true });
    lastPersistedKey = JSON.stringify(buildPersistedState(get()));
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

      const sessions = position === "start" ? [session, ...state.sessions] : [...state.sessions, session];

      const lastActivity = new Map(state.lastActivity);
      lastActivity.set(session.id, session.createdAt);

      return {
        sessions,
        activeSessionId: session.id,
        activeProjectPath: session.projectPath,
        projectSplits,
        lastActivity,
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
      const lastActivity = new Map(state.lastActivity);
      lastActivity.delete(id);

      return {
        sessions,
        activeSessionId,
        activeProjectPath: state.activeProjectPath,
        tabStatuses,
        sessionTitles,
        lastActivity,
        projectSplits,
      };
    }),

  archiveSession: (id) => {
    const state = get();
    const session = state.sessions.find((s) => s.id === id);
    if (!session) return;
    const title = state.sessionTitles.get(id);
    const activity = state.lastActivity.get(id) ?? session.createdAt;

    get().removeSession(id);

    set((current) => {
      const archivedSessions = [
        toDormantSession(toPersistedSession(session)),
        ...current.archivedSessions.filter((a) => a.id !== id),
      ];
      const dropped = archivedSessions.splice(MAX_ARCHIVED);
      const sessionTitles = new Map(current.sessionTitles);
      const lastActivity = new Map(current.lastActivity);
      if (title !== undefined) sessionTitles.set(id, title);
      lastActivity.set(id, activity);
      for (const entry of dropped) {
        sessionTitles.delete(entry.id);
        lastActivity.delete(entry.id);
      }
      return { archivedSessions, sessionTitles, lastActivity };
    });
  },

  restoreSession: (id) => {
    const state = get();
    const entry = state.archivedSessions.find((a) => a.id === id);
    if (!entry) return;

    const projectSplits = new Map(state.projectSplits);
    const split = projectSplits.get(entry.projectPath);
    if (split) {
      const pane = getPaneState(split, split.focusedPane);
      const newPane: PaneState = { sessionIds: [entry.id, ...pane.sessionIds], activeSessionId: entry.id };
      projectSplits.set(entry.projectPath, withUpdatedPane(split, split.focusedPane, newPane));
    }

    set({
      archivedSessions: state.archivedSessions.filter((a) => a.id !== id),
      sessions: [entry, ...state.sessions],
      projectSplits,
    });
    get().activateSession(id);
  },

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
      const archivedSessions = state.archivedSessions.filter((s) => s.projectPath !== projectPath);
      const projectSplits = new Map(state.projectSplits);
      projectSplits.delete(projectPath);
      const removedIds = new Set(
        [...state.sessions, ...state.archivedSessions]
          .filter((s) => s.projectPath === projectPath)
          .map((s) => s.id)
      );
      const tabStatuses = new Map(state.tabStatuses);
      const sessionTitles = new Map(state.sessionTitles);
      const lastActivity = new Map(state.lastActivity);
      for (const id of removedIds) {
        tabStatuses.delete(id);
        sessionTitles.delete(id);
        lastActivity.delete(id);
      }
      return {
        sessions,
        archivedSessions,
        activeSessionId,
        activeProjectPath,
        projectSplits,
        tabStatuses,
        sessionTitles,
        lastActivity,
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
    get().touchSession(tabId);
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

  touchSession: (id) => {
    const now = Date.now();
    const previous = get().lastActivity.get(id) ?? 0;
    if (now - previous < TOUCH_THROTTLE_MS) return;
    set((state) => {
      const next = new Map(state.lastActivity);
      next.set(id, now);
      return { lastActivity: next };
    });
  },

  moveSession: (fromIndex, toIndex) =>
    set((state) => {
      if (fromIndex === toIndex) return {};
      const sessions = [...state.sessions];
      if (fromIndex < 0 || fromIndex >= sessions.length || toIndex < 0 || toIndex >= sessions.length) return {};

      const [moved] = sessions.splice(fromIndex, 1);
      sessions.splice(toIndex, 0, moved);

      // keep the split pane's tab order in sync with the sidebar order
      const split = state.projectSplits.get(moved.projectPath);
      const pane = split ? findPane(split, moved.id) : null;
      if (!split || !pane) return { sessions };

      const paneState = getPaneState(split, pane);
      const paneIds = new Set(paneState.sessionIds);
      const sessionIds = sessions.filter((s) => paneIds.has(s.id)).map((s) => s.id);
      const projectSplits = new Map(state.projectSplits);
      projectSplits.set(moved.projectPath, withUpdatedPane(split, pane, { ...paneState, sessionIds }));
      return { sessions, projectSplits };
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
