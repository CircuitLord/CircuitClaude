import { create } from "zustand";
import { TerminalSession } from "../types";

interface SessionStore {
  sessions: TerminalSession[];
  activeSessionId: string | null;
  activeProjectPath: string | null;
  addSession: (session: TerminalSession) => void;
  removeSession: (id: string) => void;
  removeProjectSessions: (projectPath: string) => void;
  setActiveSession: (id: string | null) => void;
  setActiveProject: (path: string | null) => void;
  updateSessionPtyId: (id: string, sessionId: string) => void;
}

let nextId = 1;
export function generateTabId(): string {
  return `tab-${nextId++}`;
}

export const useSessionStore = create<SessionStore>((set) => ({
  sessions: [],
  activeSessionId: null,
  activeProjectPath: null,

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
      // But if the project has no sessions left and was the removed session's project,
      // we still keep activeProjectPath so we show the project-scoped empty state
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
}));
