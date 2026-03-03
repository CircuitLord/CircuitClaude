import { create } from "zustand";
import { readFile, writeFile } from "../lib/files";

interface EditorFileState {
  content: string;
  savedContent: string;
  loading: boolean;
  saving: boolean;
  error: string | null;
}

interface EditorStore {
  files: Map<string, EditorFileState>;
  loadFile: (tabId: string, filePath: string) => Promise<void>;
  updateContent: (tabId: string, content: string) => void;
  saveFile: (tabId: string, filePath: string) => Promise<void>;
  closeFile: (tabId: string) => void;
  isDirty: (tabId: string) => boolean;
}

export const useEditorStore = create<EditorStore>((set, get) => ({
  files: new Map(),

  loadFile: async (tabId, filePath) => {
    set((state) => {
      const next = new Map(state.files);
      next.set(tabId, {
        content: "",
        savedContent: "",
        loading: true,
        saving: false,
        error: null,
      });
      return { files: next };
    });

    try {
      const content = await readFile(filePath);
      set((state) => {
        const next = new Map(state.files);
        next.set(tabId, {
          content,
          savedContent: content,
          loading: false,
          saving: false,
          error: null,
        });
        return { files: next };
      });
    } catch (err) {
      set((state) => {
        const next = new Map(state.files);
        next.set(tabId, {
          content: "",
          savedContent: "",
          loading: false,
          saving: false,
          error: err instanceof Error ? err.message : String(err),
        });
        return { files: next };
      });
    }
  },

  updateContent: (tabId, content) =>
    set((state) => {
      const existing = state.files.get(tabId);
      if (!existing) return {};
      const next = new Map(state.files);
      next.set(tabId, { ...existing, content });
      return { files: next };
    }),

  saveFile: async (tabId, filePath) => {
    const fileState = get().files.get(tabId);
    if (!fileState) return;

    set((state) => {
      const next = new Map(state.files);
      next.set(tabId, { ...fileState, saving: true, error: null });
      return { files: next };
    });

    try {
      await writeFile(filePath, fileState.content);
      set((state) => {
        const current = state.files.get(tabId);
        if (!current) return {};
        const next = new Map(state.files);
        next.set(tabId, {
          ...current,
          savedContent: current.content,
          saving: false,
        });
        return { files: next };
      });
    } catch (err) {
      set((state) => {
        const current = state.files.get(tabId);
        if (!current) return {};
        const next = new Map(state.files);
        next.set(tabId, {
          ...current,
          saving: false,
          error: err instanceof Error ? err.message : String(err),
        });
        return { files: next };
      });
    }
  },

  closeFile: (tabId) =>
    set((state) => {
      const next = new Map(state.files);
      next.delete(tabId);
      return { files: next };
    }),

  isDirty: (tabId) => {
    const fileState = get().files.get(tabId);
    if (!fileState) return false;
    return fileState.content !== fileState.savedContent;
  },
}));
