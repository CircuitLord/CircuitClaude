import { create } from "zustand";

export type DropZone = "left" | "right" | "top" | "bottom" | null;

// tracks a session row being dragged out of the sidebar onto the terminal area
interface SessionDragStore {
  sessionId: string | null;
  projectPath: string | null;
  zone: DropZone;
  pane: 1 | 2 | null;
  start: (sessionId: string, projectPath: string) => void;
  setTarget: (zone: DropZone, pane: 1 | 2 | null) => void;
  end: () => void;
}

export const useSessionDragStore = create<SessionDragStore>((set) => ({
  sessionId: null,
  projectPath: null,
  zone: null,
  pane: null,

  start: (sessionId, projectPath) => set({ sessionId, projectPath, zone: null, pane: null }),

  setTarget: (zone, pane) =>
    set((state) => (state.zone === zone && state.pane === pane ? {} : { zone, pane })),

  end: () => set({ sessionId: null, projectPath: null, zone: null, pane: null }),
}));
