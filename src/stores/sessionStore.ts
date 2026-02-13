import { create } from "zustand";
import { TerminalSession, TabStatus } from "../types";

interface SessionStore {
  sessions: TerminalSession[];
  activeSessionId: string | null;
  activeProjectPath: string | null;
  /** Remembers the last active tab per project so switching projects preserves tab selection */
  projectActiveSessionIds: Map<string, string>;
  tabStatuses: Map<string, TabStatus>;
  sessionTitles: Map<string, string>;
  addSession: (session: TerminalSession) => void;
  removeSession: (id: string) => void;
  removeProjectSessions: (projectPath: string) => void;
  setActiveSession: (id: string | null) => void;
  setActiveProject: (path: string | null) => void;
  updateSessionPtyId: (id: string, sessionId: string) => void;
  setTabStatus: (tabId: string, status: TabStatus | null) => void;
  setSessionTitle: (tabId: string, title: string) => void;
}

export function generateTabId(): string {
  return crypto.randomUUID();
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  activeProjectPath: null,
  projectActiveSessionIds: new Map(),
  tabStatuses: new Map(),
  sessionTitles: new Map(),

  addSession: (session) =>
    set((state) => {
      const next = new Map(state.projectActiveSessionIds);
      // Save outgoing project's active tab
      if (state.activeProjectPath && state.activeSessionId) {
        next.set(state.activeProjectPath, state.activeSessionId);
      }
      // Set the new session as active for its project
      next.set(session.projectPath, session.id);
      return {
        sessions: [...state.sessions, session],
        activeSessionId: session.id,
        activeProjectPath: session.projectPath,
        projectActiveSessionIds: next,
      };
    }),

  removeSession: (id) =>
    set((state) => {
      const removed = state.sessions.find((s) => s.id === id);
      const sessions = state.sessions.filter((s) => s.id !== id);
      let activeSessionId = state.activeSessionId;
      if (state.activeSessionId === id) {
        if (removed) {
          const sameProjectSessions = sessions.filter(s => s.projectPath === removed.projectPath);
          activeSessionId = sameProjectSessions.length > 0
            ? sameProjectSessions[sameProjectSessions.length - 1].id
            : null;
        } else {
          activeSessionId = null;
        }
      }
      const activeProjectPath = state.activeProjectPath;
      const tabStatuses = new Map(state.tabStatuses);
      tabStatuses.delete(id);
      const sessionTitles = new Map(state.sessionTitles);
      sessionTitles.delete(id);
      // Clean up per-project mapping if the removed session was the remembered one
      const projectActiveSessionIds = new Map(state.projectActiveSessionIds);
      if (removed) {
        const savedId = projectActiveSessionIds.get(removed.projectPath);
        if (savedId === id) {
          projectActiveSessionIds.delete(removed.projectPath);
        }
      }
      return { sessions, activeSessionId, activeProjectPath, tabStatuses, sessionTitles, projectActiveSessionIds };
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
      const projectActiveSessionIds = new Map(state.projectActiveSessionIds);
      projectActiveSessionIds.delete(projectPath);
      return { sessions, activeSessionId, activeProjectPath, projectActiveSessionIds };
    }),

  setActiveSession: (id) => {
    const state = get();
    // Save the active tab for the current project before switching
    if (id && state.activeProjectPath) {
      const next = new Map(state.projectActiveSessionIds);
      next.set(state.activeProjectPath, id);
      set({ activeSessionId: id, projectActiveSessionIds: next });
    } else {
      set({ activeSessionId: id });
    }
  },

  setActiveProject: (path) => {
    const state = get();
    // Save the current tab for the outgoing project
    const next = new Map(state.projectActiveSessionIds);
    if (state.activeProjectPath && state.activeSessionId) {
      next.set(state.activeProjectPath, state.activeSessionId);
    }
    // Restore the saved tab for the incoming project
    const restoredSessionId = path ? next.get(path) ?? null : null;
    set({
      activeProjectPath: path,
      activeSessionId: restoredSessionId,
      projectActiveSessionIds: next,
    });
  },

  updateSessionPtyId: (id, sessionId) =>
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === id ? { ...s, sessionId } : s
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
}));
