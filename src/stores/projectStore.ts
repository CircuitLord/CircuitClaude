import { create } from "zustand";
import { Project, ThemeName } from "../types";
import { loadProjects, saveProjects } from "../lib/config";
import { THEMES } from "../lib/themes";

const THEME_NAMES = Object.keys(THEMES) as ThemeName[];

interface ProjectStore {
  projects: Project[];
  loaded: boolean;
  load: () => Promise<void>;
  addProject: (project: Project) => Promise<void>;
  removeProject: (path: string) => Promise<void>;
  reorderProjects: (paths: string[]) => Promise<void>;
  updateProjectTheme: (path: string, theme: ThemeName) => Promise<void>;
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  projects: [],
  loaded: false,

  load: async () => {
    const projects = await loadProjects();

    // Migration: if all projects have the serde default "midnight" theme,
    // distribute varied themes across them
    const allMidnight = projects.length > 0 && projects.every((p) => !p.theme || p.theme === "midnight");
    if (allMidnight) {
      for (let i = 0; i < projects.length; i++) {
        projects[i] = { ...projects[i], theme: THEME_NAMES[i % THEME_NAMES.length] };
      }
      await saveProjects(projects);
    } else {
      // Ensure every project has a valid theme
      let needsSave = false;
      for (let i = 0; i < projects.length; i++) {
        if (!projects[i].theme || !THEMES[projects[i].theme]) {
          projects[i] = { ...projects[i], theme: "midnight" };
          needsSave = true;
        }
      }
      if (needsSave) await saveProjects(projects);
    }

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

  reorderProjects: async (paths: string[]) => {
    const current = get().projects;
    const byPath = new Map(current.map((p) => [p.path, p]));
    const reordered = paths.map((path) => byPath.get(path)!).filter(Boolean);
    await saveProjects(reordered);
    set({ projects: reordered });
  },

  updateProjectTheme: async (path: string, theme: ThemeName) => {
    const updated = get().projects.map((p) =>
      p.path === path ? { ...p, theme } : p
    );
    await saveProjects(updated);
    set({ projects: updated });
  },
}));
