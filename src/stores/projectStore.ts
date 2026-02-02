import { create } from "zustand";
import { Project } from "../types";
import { loadProjects, saveProjects } from "../lib/config";

interface ProjectStore {
  projects: Project[];
  loaded: boolean;
  load: () => Promise<void>;
  addProject: (project: Project) => Promise<void>;
  removeProject: (path: string) => Promise<void>;
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  projects: [],
  loaded: false,

  load: async () => {
    const projects = await loadProjects();
    set({ projects, loaded: true });
  },

  addProject: async (project: Project) => {
    const current = get().projects;
    if (current.some((p) => p.path === project.path)) return;
    const updated = [...current, project];
    await saveProjects(updated);
    set({ projects: updated });
  },

  removeProject: async (path: string) => {
    const updated = get().projects.filter((p) => p.path !== path);
    await saveProjects(updated);
    set({ projects: updated });
  },
}));
