import { create } from "zustand";
import { GitStatus } from "../types";
import { getGitStatus } from "../lib/git";

interface GitStore {
  statuses: Record<string, GitStatus>;
  loading: Record<string, boolean>;
  sectionOpen: boolean;
  collapsedGroups: Record<string, boolean>;
  fetchStatus: (projectPath: string) => Promise<void>;
  toggleSection: () => void;
  toggleGroup: (group: string) => void;
}

export const useGitStore = create<GitStore>((set, get) => ({
  statuses: {},
  loading: {},
  sectionOpen: true,
  collapsedGroups: {},

  fetchStatus: async (projectPath: string) => {
    if (get().loading[projectPath]) return;
    set((state) => ({ loading: { ...state.loading, [projectPath]: true } }));
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
}));
