import { create } from "zustand";
import { Settings, DEFAULT_SETTINGS } from "../types";
import { loadSettings, saveSettings } from "../lib/config";

interface SettingsStore {
  settings: Settings;
  loaded: boolean;
  settingsDialogOpen: boolean;
  load: () => Promise<void>;
  update: (partial: Partial<Settings>) => Promise<void>;
  openSettingsDialog: () => void;
  closeSettingsDialog: () => void;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  settingsDialogOpen: false,

  load: async () => {
    const saved = await loadSettings();
    if (saved) {
      const merged = { ...DEFAULT_SETTINGS, ...saved };
      set({ settings: merged, loaded: true });
    } else {
      set({ loaded: true });
    }
  },

  update: async (partial: Partial<Settings>) => {
    const updated = { ...get().settings, ...partial };
    set({ settings: updated });
    await saveSettings(updated);
  },

  openSettingsDialog: () => set({ settingsDialogOpen: true }),
  closeSettingsDialog: () => set({ settingsDialogOpen: false }),
}));
