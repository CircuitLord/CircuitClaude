import { create } from "zustand";
import { Settings, DEFAULT_SETTINGS } from "../types";
import { loadSettings, saveSettings } from "../lib/config";

const EDITABLE_SESSION_TYPE_IDS = new Set(DEFAULT_SETTINGS.sessionTypes.map((type) => type.id));

function normalizeEditableSessionTypes(settings: Settings): Settings {
  const sessionTypes = (settings.sessionTypes?.length ? settings.sessionTypes : DEFAULT_SETTINGS.sessionTypes)
    .filter((type) => type.id !== "pi-chat");
  const mergedIds = new Set(sessionTypes.map((type) => type.id));
  const mergedSessionTypes = [
    ...sessionTypes,
    ...DEFAULT_SETTINGS.sessionTypes.filter((type) => !mergedIds.has(type.id)),
  ];
  const defaultSessionType = mergedSessionTypes.some((type) => type.id === settings.defaultSessionType)
    ? settings.defaultSessionType
    : DEFAULT_SETTINGS.defaultSessionType;

  return {
    ...settings,
    sessionTypes: mergedSessionTypes.filter((type) => EDITABLE_SESSION_TYPE_IDS.has(type.id) || !DEFAULT_SETTINGS.sessionTypes.some((defaultType) => defaultType.id === type.id)),
    defaultSessionType,
  };
}

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
      const merged = normalizeEditableSessionTypes({ ...DEFAULT_SETTINGS, ...saved });
      set({ settings: merged, loaded: true });
      if (saved.sessionTypes?.some((type) => type.id === "pi-chat") || saved.defaultSessionType === "pi-chat") {
        await saveSettings(merged);
      }
    } else {
      set({ loaded: true });
    }
  },

  update: async (partial: Partial<Settings>) => {
    const updated = normalizeEditableSessionTypes({ ...get().settings, ...partial });
    set({ settings: updated });
    await saveSettings(updated);
  },

  openSettingsDialog: () => set({ settingsDialogOpen: true }),
  closeSettingsDialog: () => set({ settingsDialogOpen: false }),
}));
