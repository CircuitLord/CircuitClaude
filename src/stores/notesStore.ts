import { create } from "zustand";
import { loadNote, saveNote } from "../lib/config";

interface NotesState {
  isOpen: boolean;
  projectPath: string;
  content: string;
  saving: boolean;
  loading: boolean;
  open: (projectPath: string) => void;
  close: () => void;
  setContent: (content: string) => void;
  save: () => Promise<void>;
}

export const useNotesStore = create<NotesState>((set, get) => ({
  isOpen: false,
  projectPath: "",
  content: "",
  saving: false,
  loading: false,

  open: async (projectPath: string) => {
    set({ isOpen: true, loading: true, projectPath });
    try {
      const content = await loadNote(projectPath);
      set({ content, loading: false });
    } catch {
      set({ content: "", loading: false });
    }
  },

  close: () => {
    const { projectPath, content } = get();
    if (projectPath) {
      saveNote(projectPath, content).catch(() => {});
    }
    set({ isOpen: false, content: "", projectPath: "" });
  },

  setContent: (content: string) => {
    set({ content });
  },

  save: async () => {
    const { projectPath, content } = get();
    if (!projectPath) return;
    set({ saving: true });
    try {
      await saveNote(projectPath, content);
    } catch {
      // silent
    }
    set({ saving: false });
  },
}));
