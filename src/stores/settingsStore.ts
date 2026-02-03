import { create } from "zustand";
import { Settings, DEFAULT_SETTINGS } from "../types";
import { loadSettings, saveSettings } from "../lib/config";
import { applyThemeToDOM } from "../lib/themes";

interface SettingsStore {
  settings: Settings;
  loaded: boolean;
  load: () => Promise<void>;
  update: (partial: Partial<Settings>) => Promise<void>;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,

  load: async () => {
    const saved = await loadSettings();
    if (saved) {
      const merged = { ...DEFAULT_SETTINGS, ...saved };
      applyThemeToDOM(merged.theme);
      set({ settings: merged, loaded: true });
    } else {
      applyThemeToDOM(DEFAULT_SETTINGS.theme);
      set({ loaded: true });
    }
  },

  update: async (partial: Partial<Settings>) => {
    const updated = { ...get().settings, ...partial };
    if (partial.theme) {
      applyThemeToDOM(updated.theme);
    }
    set({ settings: updated });
    await saveSettings(updated);
  },
}));
