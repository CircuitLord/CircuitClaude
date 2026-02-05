import { create } from "zustand";
import { TerminalSession, SessionsConfig } from "../types";

interface SessionStore {
  sessions: TerminalSession[];
  activeSessionId: string | null;
  activeProjectPath: string | null;
  thinkingSessions: Set<string>;
  needsAttentionSessions: Set<string>;
  sessionTitles: Map<string, string>;
  companionVisible: boolean;
  toggleCompanion: () => void;
  addSession: (session: TerminalSession) => void;
  removeSession: (id: string) => void;
  removeProjectSessions: (projectPath: string) => void;
  setActiveSession: (id: string | null) => void;
  setActiveProject: (path: string | null) => void;
  updateSessionPtyId: (id: string, sessionId: string) => void;
  setThinking: (tabId: string, isThinking: boolean) => void;
  setNeedsAttention: (tabId: string, needsAttention: boolean) => void;
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
  thinkingSessions: new Set(),
  needsAttentionSessions: new Set(),
  sessionTitles: new Map(),
  companionVisible: false,
  toggleCompanion: () => set((state) => ({ companionVisible: !state.companionVisible })),

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
      // Stay on the same project even if last session is removed
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

  setThinking: (tabId, isThinking) =>
    set((state) => {
      const next = new Set(state.thinkingSessions);
      if (isThinking) {
        next.add(tabId);
      } else {
        next.delete(tabId);
      }
      return { thinkingSessions: next };
    }),

  setNeedsAttention: (tabId, needsAttention) =>
    set((state) => {
      const next = new Set(state.needsAttentionSessions);
      if (needsAttention) {
        next.add(tabId);
      } else {
        next.delete(tabId);
      }
      return { needsAttentionSessions: next };
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
            restorePending: true,
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
      if (!s.hasInteracted && !s.restored && !s.restorePending) continue;
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
