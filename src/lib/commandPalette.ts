import { useSessionStore } from "../stores/sessionStore";
import { useSettingsStore } from "../stores/settingsStore";
import { readClaudeMd, readAgentsMd } from "./config";
import { spawnNewSession, closeTab, openFileTab } from "./sessions";

export type PaletteMode = "files" | "commands" | "everything";

export interface PaletteCommand {
  id: string;
  label: string;
  shortcut?: string;
  category: string;
  action: () => void;
}

export function getPaletteCommands(): PaletteCommand[] {
  const commands: PaletteCommand[] = [];

  // Session commands
  commands.push({
    id: "new-claude",
    label: "New Claude session",
    shortcut: "Ctrl+T",
    category: "session",
    action: () => spawnNewSession("claude"),
  });
  commands.push({
    id: "new-codex",
    label: "New Codex session",
    category: "session",
    action: () => spawnNewSession("codex"),
  });
  commands.push({
    id: "new-shell",
    label: "New shell session",
    category: "session",
    action: () => spawnNewSession("shell"),
  });
  commands.push({
    id: "close-tab",
    label: "Close active tab",
    shortcut: "Ctrl+W",
    category: "session",
    action: () => {
      const { activeSessionId } = useSessionStore.getState();
      if (activeSessionId) closeTab(activeSessionId);
    },
  });

  // Config commands
  commands.push({
    id: "claude-md",
    label: "Edit CLAUDE.md",
    category: "config",
    action: () => {
      const { activeProjectPath } = useSessionStore.getState();
      readClaudeMd(activeProjectPath ?? undefined).then((r) => openFileTab(r.path, "CLAUDE.md", false));
    },
  });
  commands.push({
    id: "agents-md",
    label: "Edit agents.md",
    category: "config",
    action: () => {
      const { activeProjectPath } = useSessionStore.getState();
      readAgentsMd(activeProjectPath ?? undefined).then((r) => openFileTab(r.path, "agents.md", false));
    },
  });
  commands.push({
    id: "settings",
    label: "Open settings",
    category: "config",
    action: () => useSettingsStore.getState().openSettingsDialog(),
  });

  return commands;
}

/** Simple fuzzy match scoring. Higher = better match. Returns -1 for no match. */
export function fuzzyMatch(query: string, target: string): number {
  const q = query.toLowerCase();
  const t = target.toLowerCase();

  // Exact substring bonus
  if (t.includes(q)) {
    // Prefer filename matches over full path matches
    const filename = target.split("/").pop() ?? target;
    if (filename.toLowerCase().includes(q)) {
      return 1000 + (100 - filename.length);
    }
    return 500 + (100 - target.length);
  }

  // Character-by-character fuzzy match
  let qi = 0;
  let score = 0;
  let consecutive = 0;

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      qi++;
      consecutive++;
      score += consecutive * 2; // consecutive matches weighted higher
      // Bonus for matching after separator
      if (ti === 0 || t[ti - 1] === "/" || t[ti - 1] === "." || t[ti - 1] === "-" || t[ti - 1] === "_") {
        score += 5;
      }
    } else {
      consecutive = 0;
    }
  }

  // All query chars must be found
  if (qi < q.length) return -1;

  return score;
}
