import { create } from "zustand";
import type { PaletteMode } from "../lib/commandPalette";

interface CommandPaletteStore {
  isOpen: boolean;
  initialMode: PaletteMode;
  open: (mode?: PaletteMode) => void;
  close: () => void;
}

export const useCommandPaletteStore = create<CommandPaletteStore>((set) => ({
  isOpen: false,
  initialMode: "files",

  open: (mode: PaletteMode = "files") => {
    set({ isOpen: true, initialMode: mode });
  },

  close: () => {
    set({ isOpen: false });
  },
}));
