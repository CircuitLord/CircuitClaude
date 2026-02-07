import { create } from "zustand";
import { TerminalSession, SessionsConfig } from "../types";

interface SessionStore {
  sessions: TerminalSession[];
  activeSessionId: string | null;
  activeProjectPath: string | null;
  streamingSessions: Set<string>;
  sessionTitles: Map<string, string>;
  addSession: (session: TerminalSession) => void;
  removeSession: (id: string) => void;
  removeProjectSessions: (projectPath: string) => void;
  setActiveSession: (id: string | null) => void;
  setActiveProject: (path: string | null) => void;
  updateSessionPtyId: (id: string, sessionId: string) => void;
  setStreaming: (tabId: string, isStreaming: boolean) => void;
  setSessionTitle: (tabId: string, title: string) => void;
  markInteracted: (tabId: string) => void;
  confirmRestore: (tabId: string) => void;
  restoreFromConfig: (config: SessionsConfig) => void;
  toSessionsConfig: () => SessionsConfig;
  clearRestoredFlag: (id: string) => void;
}

export function generateTabId(): string {
  return crypto.randomUUID();
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  activeProjectPath: null,
  streamingSessions: new Set(),
  sessionTitles: new Map(),

  addSession: (session) =>
    set((state) => ({
      sessions: [...state.sessions, session],
      activeSessionId: session.id,
      activeProjectPath: session.projectPath,
    })),

  removeSession: (id) =>
    set((state) => {
      const sessions = state.sessions.filter((s) => s.id !== id);
      const activeSessionId =
        state.activeSessionId === id
          ? sessions.length > 0
            ? sessions[sessions.length - 1].id
            : null
          : state.activeSessionId;
      const activeProjectPath = state.activeProjectPath;
      return { sessions, activeSessionId, activeProjectPath };
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
      return { sessions, activeSessionId, activeProjectPath };
    }),

  setActiveSession: (id) => set({ activeSessionId: id }),

  setActiveProject: (path) => set({ activeProjectPath: path }),

  updateSessionPtyId: (id, sessionId) =>
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === id ? { ...s, sessionId } : s
      ),
    })),

  setStreaming: (tabId, isStreaming) =>
    set((state) => {
      const next = new Set(state.streamingSessions);
      if (isStreaming) {
        next.add(tabId);
      } else {
        next.delete(tabId);
      }
      return { streamingSessions: next };
    }),

  setSessionTitle: (tabId, title) =>
    set((state) => {
      const next = new Map(state.sessionTitles);
      next.set(tabId, title);
      return { sessionTitles: next };
    }),

  markInteracted: (tabId) =>
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === tabId ? { ...s, hasInteracted: true } : s
      ),
    })),

  confirmRestore: (tabId) =>
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === tabId ? { ...s, restorePending: undefined, hasInteracted: true } : s
      ),
    })),

  restoreFromConfig: (config) =>
    set(() => {
      const sessions: TerminalSession[] = [];
      for (const layout of config.layouts) {
        for (const ps of layout.sessions) {
          sessions.push({
            id: ps.id,
            projectName: ps.projectName,
            projectPath: ps.projectPath,
            sessionId: null,
            claudeSessionId: ps.claudeSessionId,
            createdAt: ps.createdAt,
            restored: true,
            restorePending: false, // No longer pending — conversation view loads history directly
            hasInteracted: true, // Restored sessions are considered interacted
            sessionType: ps.sessionType ?? "claude",
          });
        }
      }
      return {
        sessions,
        activeProjectPath: config.activeProjectPath ?? null,
        activeSessionId: config.activeSessionId ?? null,
      };
    }),

  toSessionsConfig: () => {
    const state = get();
    const byProject = new Map<string, TerminalSession[]>();
    for (const s of state.sessions) {
      if (s.sessionType === "shell") continue;
      if (!s.hasInteracted && !s.restored) continue;
      const list = byProject.get(s.projectPath) ?? [];
      list.push(s);
      byProject.set(s.projectPath, list);
    }
    const layouts = Array.from(byProject.entries()).map(
      ([projectPath, sessions]) => ({
        projectPath,
        sessions: sessions.map((s) => ({
          id: s.id,
          projectName: s.projectName,
          projectPath: s.projectPath,
          claudeSessionId: s.claudeSessionId,
          createdAt: s.createdAt,
          sessionType: s.sessionType,
        })),
      })
    );
    return {
      layouts,
      activeProjectPath: state.activeProjectPath,
      activeSessionId: state.activeSessionId,
    };
  },

  clearRestoredFlag: (id) =>
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === id ? { ...s, restored: undefined } : s
      ),
    })),
}));
