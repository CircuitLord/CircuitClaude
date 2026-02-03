import { create } from "zustand";
import { GitFileEntry, GitStatus } from "../types";
import { getGitDiff, getGitStatus } from "../lib/git";

interface GitStore {
  statuses: Record<string, GitStatus>;
  loading: Record<string, boolean>;
  sectionOpen: boolean;
  collapsedGroups: Record<string, boolean>;
  diffFile: GitFileEntry | null;
  diffContent: string | null;
  diffLoading: boolean;
  fetchStatus: (projectPath: string) => Promise<void>;
  toggleSection: () => void;
  toggleGroup: (group: string) => void;
  openDiff: (projectPath: string, file: GitFileEntry) => Promise<void>;
  closeDiff: () => void;
}

export const useGitStore = create<GitStore>((set) => ({
  statuses: {},
  loading: {},
  sectionOpen: true,
  collapsedGroups: {},
  diffFile: null,
  diffContent: null,
  diffLoading: false,

  fetchStatus: async (projectPath: string) => {
    set((state) => {
      if (state.loading[projectPath]) return state;
      return { loading: { ...state.loading, [projectPath]: true } };
    });
    try {
      const status = await getGitStatus(projectPath);
      set((state) => ({
        statuses: { ...state.statuses, [projectPath]: status },
      }));
    } catch {
      // silently ignore — project may not exist or git not available
    } finally {
      set((state) => ({ loading: { ...state.loading, [projectPath]: false } }));
    }
  },

  toggleSection: () => set((state) => ({ sectionOpen: !state.sectionOpen })),

  toggleGroup: (group: string) =>
    set((state) => ({
      collapsedGroups: {
        ...state.collapsedGroups,
        [group]: !state.collapsedGroups[group],
      },
    })),

  openDiff: async (projectPath: string, file: GitFileEntry) => {
    set({ diffFile: file, diffContent: null, diffLoading: true });
    try {
      const content = await getGitDiff(projectPath, file.path, file.staged, file.status);
      set({ diffContent: content, diffLoading: false });
    } catch {
      set({ diffContent: null, diffLoading: false });
    }
  },

  closeDiff: () => set({ diffFile: null, diffContent: null, diffLoading: false }),
}));
