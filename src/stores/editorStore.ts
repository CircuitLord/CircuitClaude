import { create } from "zustand";
import { readFile, writeFile, watchFile, unwatchFile } from "../lib/files";

interface EditorFileState {
  filePath: string;
  content: string;
  savedContent: string;
  loading: boolean;
  saving: boolean;
  error: string | null;
  readOnly: boolean;
}

interface EditorStore {
  files: Map<string, EditorFileState>;
  loadFile: (tabId: string, filePath: string) => Promise<void>;
  updateContent: (tabId: string, content: string) => void;
  saveFile: (tabId: string, filePath: string) => Promise<void>;
  closeFile: (tabId: string) => void;
  isDirty: (tabId: string) => boolean;
  setReadOnly: (tabId: string, readOnly: boolean) => void;
  /** Re-reads file from disk; returns new content if it changed externally, null otherwise. */
  checkExternalChange: (tabId: string, filePath: string) => Promise<string | null>;
}

export const useEditorStore = create<EditorStore>((set, get) => ({
  files: new Map(),

  loadFile: async (tabId, filePath) => {
    set((state) => {
      const next = new Map(state.files);
      next.set(tabId, {
        filePath,
        content: "",
        savedContent: "",
        loading: true,
        saving: false,
        error: null,
        readOnly: true,
      });
      return { files: next };
    });

    try {
      const content = await readFile(filePath);
      set((state) => {
        const next = new Map(state.files);
        next.set(tabId, {
          filePath,
          content,
          savedContent: content,
          loading: false,
          saving: false,
          error: null,
          readOnly: true,
        });
        return { files: next };
      });
      watchFile(tabId, filePath).catch(() => {});
    } catch (err) {
      set((state) => {
        const next = new Map(state.files);
        next.set(tabId, {
          filePath,
          content: "",
          savedContent: "",
          loading: false,
          saving: false,
          error: err instanceof Error ? err.message : String(err),
          readOnly: true,
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

  closeFile: (tabId) => {
    const fileState = get().files.get(tabId);
    if (fileState?.filePath) {
      unwatchFile(tabId, fileState.filePath).catch(() => {});
    }
    set((state) => {
      const next = new Map(state.files);
      next.delete(tabId);
      return { files: next };
    });
  },

  setReadOnly: (tabId, readOnly) =>
    set((state) => {
      const existing = state.files.get(tabId);
      if (!existing) return {};
      const next = new Map(state.files);
      next.set(tabId, { ...existing, readOnly });
      return { files: next };
    }),

  isDirty: (tabId) => {
    const fileState = get().files.get(tabId);
    if (!fileState) return false;
    return fileState.content !== fileState.savedContent;
  },

  checkExternalChange: async (tabId, filePath) => {
    const fileState = get().files.get(tabId);
    if (!fileState || fileState.loading || fileState.saving) return null;

    try {
      const diskContent = await readFile(filePath);
      // Only act if disk differs from what we last saved (external change)
      if (diskContent === fileState.savedContent) return null;

      // If user has unsaved edits, don't overwrite them
      if (fileState.content !== fileState.savedContent) return null;

      set((state) => {
        const next = new Map(state.files);
        next.set(tabId, {
          ...fileState,
          content: diskContent,
          savedContent: diskContent,
        });
        return { files: next };
      });
      return diskContent;
    } catch {
      return null;
    }
  },
}));
