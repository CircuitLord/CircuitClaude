import { create } from "zustand";
import { readClaudeMd, saveClaudeMd, readAgentsMd, saveAgentsMd } from "../lib/config";

type FileKind = "claude" | "agents";

interface ClaudeMdState {
  isOpen: boolean;
  fileKind: FileKind;
  projectPath: string | undefined; // undefined = global
  filePath: string;
  content: string;
  saving: boolean;
  loading: boolean;
  error: string | null;
  open: (projectPath?: string) => void;
  openAgents: (projectPath?: string) => void;
  close: () => void;
  setContent: (content: string) => void;
  save: () => Promise<void>;
}

export const useClaudeMdStore = create<ClaudeMdState>((set, get) => ({
  isOpen: false,
  fileKind: "claude",
  projectPath: undefined,
  filePath: "",
  content: "",
  saving: false,
  loading: false,
  error: null,

  open: async (projectPath?: string) => {
    set({ isOpen: true, fileKind: "claude", loading: true, error: null, projectPath });
    try {
      const result = await readClaudeMd(projectPath);
      set({ filePath: result.path, content: result.content, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  openAgents: async (projectPath?: string) => {
    set({ isOpen: true, fileKind: "agents", loading: true, error: null, projectPath });
    try {
      const result = await readAgentsMd(projectPath);
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
    const { fileKind, projectPath, content } = get();
    set({ saving: true, error: null });
    try {
      if (fileKind === "agents") {
        await saveAgentsMd(projectPath, content);
      } else {
        await saveClaudeMd(projectPath, content);
      }
      set({ saving: false });
    } catch (e) {
      set({ error: String(e), saving: false });
    }
  },
}));
