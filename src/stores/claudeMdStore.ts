import { create } from "zustand";
import { readClaudeMd, saveClaudeMd } from "../lib/config";

interface ClaudeMdState {
  isOpen: boolean;
  projectPath: string | undefined; // undefined = global
  filePath: string;
  content: string;
  saving: boolean;
  loading: boolean;
  error: string | null;
  open: (projectPath?: string) => void;
  close: () => void;
  setContent: (content: string) => void;
  save: () => Promise<void>;
}

export const useClaudeMdStore = create<ClaudeMdState>((set, get) => ({
  isOpen: false,
  projectPath: undefined,
  filePath: "",
  content: "",
  saving: false,
  loading: false,
  error: null,

  open: async (projectPath?: string) => {
    set({ isOpen: true, loading: true, error: null, projectPath });
    try {
      const result = await readClaudeMd(projectPath);
      set({ filePath: result.path, content: result.content, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  close: () => {
    set({ isOpen: false, content: "", filePath: "", error: null });
  },

  setContent: (content: string) => {
    set({ content });
  },

  save: async () => {
    const { projectPath, content } = get();
    set({ saving: true, error: null });
    try {
      await saveClaudeMd(projectPath, content);
      set({ saving: false });
    } catch (e) {
      set({ error: String(e), saving: false });
    }
  },
}));
