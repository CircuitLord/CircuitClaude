import { create } from "zustand";
import { GitFileEntry, GitStatus } from "../types";
import { getGitDiff, getGitStatus, gitCommit, gitRevert } from "../lib/git";

export function fileKey(file: GitFileEntry): string {
  return `${file.path}:${file.staged}`;
}

interface GitStore {
  statuses: Record<string, GitStatus>;
  loading: Record<string, boolean>;
  sectionOpen: boolean;
  collapsedGroups: Record<string, boolean>;
  viewMode: "file" | "tree";
  diffFile: GitFileEntry | null;
  diffContent: string | null;
  diffLoading: boolean;
  selectedFiles: Record<string, boolean>;
  commitMessage: string;
  committing: boolean;
  reverting: boolean;
  fetchStatus: (projectPath: string) => Promise<void>;
  toggleSection: () => void;
  toggleGroup: (group: string) => void;
  setViewMode: (mode: "file" | "tree") => void;
  openDiff: (projectPath: string, file: GitFileEntry) => Promise<void>;
  closeDiff: () => void;
  toggleFileSelection: (file: GitFileEntry) => void;
  selectAllInGroup: (files: GitFileEntry[]) => void;
  deselectAllInGroup: (files: GitFileEntry[]) => void;
  clearSelection: () => void;
  setCommitMessage: (msg: string) => void;
  commitSelected: (projectPath: string) => Promise<void>;
  revertFiles: (projectPath: string, files: GitFileEntry[]) => Promise<void>;
}

function selectedCount(sel: Record<string, boolean>): number {
  let count = 0;
  for (const k in sel) {
    if (sel[k]) count++;
  }
  return count;
}

export const useGitStore = create<GitStore>((set, get) => ({
  statuses: {},
  loading: {},
  sectionOpen: true,
  collapsedGroups: {},
  viewMode: "file",
  diffFile: null,
  diffContent: null,
  diffLoading: false,
  selectedFiles: {},
  commitMessage: "",
  committing: false,
  reverting: false,

  fetchStatus: async (projectPath: string) => {
    set((state) => {
      if (state.loading[projectPath]) return state;
      return { loading: { ...state.loading, [projectPath]: true } };
    });
    try {
      const status = await getGitStatus(projectPath);
      set((state) => {
        // Prune selected files to only keys that still exist
        const validKeys = new Set(status.files.map((f) => fileKey(f)));
        const pruned: Record<string, boolean> = {};
        for (const key in state.selectedFiles) {
          if (state.selectedFiles[key] && validKeys.has(key)) {
            pruned[key] = true;
          }
        }
        return {
          statuses: { ...state.statuses, [projectPath]: status },
          selectedFiles: pruned,
        };
      });
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

  setViewMode: (mode: "file" | "tree") => set({ viewMode: mode }),

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

  toggleFileSelection: (file: GitFileEntry) =>
    set((state) => {
      const key = fileKey(file);
      const next = { ...state.selectedFiles };
      if (next[key]) {
        delete next[key];
      } else {
        next[key] = true;
      }
      return { selectedFiles: next };
    }),

  selectAllInGroup: (files: GitFileEntry[]) =>
    set((state) => {
      const next = { ...state.selectedFiles };
      for (const f of files) next[fileKey(f)] = true;
      return { selectedFiles: next };
    }),

  deselectAllInGroup: (files: GitFileEntry[]) =>
    set((state) => {
      const next = { ...state.selectedFiles };
      for (const f of files) delete next[fileKey(f)];
      return { selectedFiles: next };
    }),

  clearSelection: () => set({ selectedFiles: {} }),

  setCommitMessage: (msg: string) => set({ commitMessage: msg }),

  commitSelected: async (projectPath: string) => {
    const { selectedFiles: sel, commitMessage, statuses } = get();
    if (selectedCount(sel) === 0 || !commitMessage.trim()) return;

    const status = statuses[projectPath];
    if (!status) return;

    // Resolve selected keys back to file paths
    const filePaths: string[] = [];
    for (const f of status.files) {
      if (sel[fileKey(f)]) {
        filePaths.push(f.path);
      }
    }
    if (filePaths.length === 0) return;

    // Deduplicate paths (a file might appear in both staged + unstaged)
    const uniquePaths = [...new Set(filePaths)];

    set({ committing: true });
    try {
      await gitCommit(projectPath, uniquePaths, commitMessage.trim());
      set({ selectedFiles: {}, commitMessage: "" });
      await get().fetchStatus(projectPath);
    } catch (e) {
      throw e;
    } finally {
      set({ committing: false });
    }
  },

  revertFiles: async (projectPath: string, files: GitFileEntry[]) => {
    if (files.length === 0) return;
    set({ reverting: true });
    try {
      await gitRevert(projectPath, files);
      // Remove reverted files from selection
      set((state) => {
        const next = { ...state.selectedFiles };
        for (const f of files) delete next[fileKey(f)];
        return { selectedFiles: next };
      });
      await get().fetchStatus(projectPath);
    } catch (e) {
      throw e;
    } finally {
      set({ reverting: false });
    }
  },
}));
