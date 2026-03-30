import { create } from "zustand";
import { PinnedFile } from "../types";
import { loadPinnedFiles, savePinnedFiles } from "../lib/config";

interface PinnedFilesStore {
  pins: PinnedFile[];
  loaded: boolean;
  load: () => Promise<void>;
  addPin: (pin: PinnedFile) => Promise<void>;
  removePin: (path: string) => Promise<void>;
  updatePin: (path: string, updates: Partial<PinnedFile>) => Promise<void>;
}

export const usePinnedFilesStore = create<PinnedFilesStore>((set, get) => ({
  pins: [],
  loaded: false,

  load: async () => {
    const pins = await loadPinnedFiles();
    set({ pins, loaded: true });
  },

  addPin: async (pin: PinnedFile) => {
    const current = get().pins;
    if (current.some((p) => p.path === pin.path)) return;
    const updated = [...current, pin];
    await savePinnedFiles(updated);
    set({ pins: updated });
  },

  removePin: async (path: string) => {
    const updated = get().pins.filter((p) => p.path !== path);
    await savePinnedFiles(updated);
    set({ pins: updated });
  },

  updatePin: async (path: string, updates: Partial<PinnedFile>) => {
    const updated = get().pins.map((p) =>
      p.path === path ? { ...p, ...updates } : p
    );
    await savePinnedFiles(updated);
    set({ pins: updated });
  },
}));
