import { create } from "zustand";
import { loadNote, saveNote } from "../lib/config";
import { useSettingsStore } from "./settingsStore";

let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
const cache = new Map<string, string>();

interface NotesState {
  isOpen: boolean;
  projectPath: string;
  content: string;
  saving: boolean;
  loading: boolean;
  dirty: boolean;
  toggle: () => void;
  preloadAll: (projectPaths: string[]) => void;
  loadForProject: (projectPath: string) => void;
  setContent: (content: string) => void;
  save: () => Promise<void>;
  flush: () => Promise<void>;
}

export const useNotesStore = create<NotesState>((set, get) => ({
  isOpen: false,
  projectPath: "",
  content: "",
  saving: false,
  loading: false,
  dirty: false,

  toggle: () => {
    const newOpen = !get().isOpen;
    set({ isOpen: newOpen });
    useSettingsStore.getState().update({ notesPanelOpen: newOpen });
  },

  preloadAll: async (projectPaths: string[]) => {
    await Promise.all(
      projectPaths.map(async (path) => {
        if (cache.has(path)) return;
        try {
          cache.set(path, await loadNote(path));
        } catch {
          cache.set(path, "");
        }
      })
    );
  },

  loadForProject: async (projectPath: string) => {
    const state = get();
    // Save current dirty content before switching
    if (state.dirty && state.projectPath) {
      await saveNote(state.projectPath, state.content).catch(() => {});
      cache.set(state.projectPath, state.content);
    }
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer);
      autoSaveTimer = null;
    }

    // Use cache for instant switch
    const cached = cache.get(projectPath);
    if (cached !== undefined) {
      set({ projectPath, content: cached, dirty: false, loading: false });
      return;
    }

    set({ loading: true, projectPath, content: "", dirty: false });
    try {
      const content = await loadNote(projectPath);
      cache.set(projectPath, content);
      set({ content, loading: false });
    } catch {
      cache.set(projectPath, "");
      set({ content: "", loading: false });
    }
  },

  setContent: (content: string) => {
    set({ content, dirty: true });
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => {
      autoSaveTimer = null;
      get().save();
    }, 1500);
  },

  save: async () => {
    const { projectPath, content, dirty } = get();
    if (!projectPath || !dirty) return;
    set({ saving: true });
    try {
      await saveNote(projectPath, content);
      cache.set(projectPath, content);
      set({ dirty: false });
    } catch {
      // silent
    }
    set({ saving: false });
  },

  flush: async () => {
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer);
      autoSaveTimer = null;
    }
    const { dirty } = get();
    if (dirty) {
      await get().save();
    }
  },
}));
