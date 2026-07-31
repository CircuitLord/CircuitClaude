import { create } from "zustand";

export type ActionId = "new-chat";

interface ActionMenuStore {
  isOpen: boolean;
  initialAction: ActionId | null;
  // bumped on each open so the panel remounts with fresh state
  openCount: number;
  open: (action?: ActionId) => void;
  close: () => void;
}

export const useActionMenuStore = create<ActionMenuStore>((set) => ({
  isOpen: false,
  initialAction: null,
  openCount: 0,

  open: (action?: ActionId) => {
    set((s) => ({ isOpen: true, initialAction: action ?? null, openCount: s.openCount + 1 }));
  },

  close: () => {
    set({ isOpen: false });
  },
}));
