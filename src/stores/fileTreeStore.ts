import { create } from "zustand";
import { FileTreeEntry } from "../types";
import { readDirectory } from "../lib/files";

interface FileTreeStore {
  entries: Record<string, FileTreeEntry[]>; // keyed by dirPath (empty string = root)
  expandedDirs: Record<string, boolean>;
  loading: Record<string, boolean>;
  fetchDirectory: (projectPath: string, dirPath?: string) => Promise<void>;
  toggleDir: (projectPath: string, dirPath: string) => void;
  collapseAll: () => void;
  clearProject: () => void;
}

export const useFileTreeStore = create<FileTreeStore>((set, get) => ({
  entries: {},
  expandedDirs: {},
  loading: {},

  fetchDirectory: async (projectPath, dirPath) => {
    const key = dirPath ?? "";
    const { loading } = get();
    if (loading[key]) return;

    set({ loading: { ...get().loading, [key]: true } });
    try {
      const result = await readDirectory(projectPath, dirPath);
      set({ entries: { ...get().entries, [key]: result } });
    } catch {
      // On error, set empty entries so we don't retry infinitely
      set({ entries: { ...get().entries, [key]: [] } });
    } finally {
      set({ loading: { ...get().loading, [key]: false } });
    }
  },

  toggleDir: (projectPath, dirPath) => {
    const { expandedDirs, entries } = get();
    const isExpanded = expandedDirs[dirPath] ?? false;

    if (isExpanded) {
      set({ expandedDirs: { ...expandedDirs, [dirPath]: false } });
    } else {
      set({ expandedDirs: { ...expandedDirs, [dirPath]: true } });
      // Fetch children if not cached
      if (!entries[dirPath]) {
        get().fetchDirectory(projectPath, dirPath);
      }
    }
  },

  collapseAll: () => {
    set({ expandedDirs: {} });
  },

  clearProject: () => {
    set({ entries: {}, expandedDirs: {}, loading: {} });
  },
}));
