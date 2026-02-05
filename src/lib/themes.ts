import type { ITheme } from "@xterm/xterm";
import type { ThemeName, SyntaxThemeName } from "../types";

interface ThemeDefinition {
  label: string;
  accent: string;
  css: Record<string, string>;
  xterm: ITheme;
}

export const THEMES: Record<ThemeName, ThemeDefinition> = {
  midnight: {
    label: "Midnight",
    accent: "#7c3aed",
    css: {
      "--bg-base":            "#0a0a0e",
      "--bg-surface":         "#101014",
      "--bg-elevated":        "#16161b",
      "--bg-overlay":         "#1b1b21",
      "--border-subtle":      "#1c1c23",
      "--border-visible":     "#26262e",
      "--text-primary":       "#ededf0",
      "--text-secondary":     "#9898a6",
      "--text-tertiary":      "#7e7e8e",
      "--accent":             "#7c3aed",
      "--accent-muted":       "rgba(124, 58, 237, 0.15)",
      "--accent-text":        "#a78bfa",
      "--accent-hover":       "#6d28d9",
      "--accent-muted-hover": "rgba(124, 58, 237, 0.25)",
      "--terminal-border":    "#2a2a34",
    },
    xterm: {
      background:            "#0a0a0e",
      foreground:            "#ededf0",
      cursor:                "#7c3aed",
      cursorAccent:          "#0a0a0e",
      selectionBackground:   "rgba(124, 58, 237, 0.25)",
      selectionForeground:   "#ededf0",
      black:                 "#0a0a0e",
      brightBlack:           "#7e7e8e",
      white:                 "#ededf0",
      brightWhite:           "#ffffff",
    },
  },

  ember: {
    label: "Ember",
    accent: "#e07020",
    css: {
      "--bg-base":            "#0a0a0b",
      "--bg-surface":         "#101012",
      "--bg-elevated":        "#161618",
      "--bg-overlay":         "#1b1b1e",
      "--border-subtle":      "#1c1c1f",
      "--border-visible":     "#26262b",
      "--text-primary":       "#ededee",
      "--text-secondary":     "#9898a0",
      "--text-tertiary":      "#7e7e86",
      "--accent":             "#e07020",
      "--accent-muted":       "rgba(224, 112, 32, 0.15)",
      "--accent-text":        "#f0a060",
      "--accent-hover":       "#c06018",
      "--accent-muted-hover": "rgba(224, 112, 32, 0.25)",
      "--terminal-border":    "#26262b",
    },
    xterm: {
      background:            "#0a0a0b",
      foreground:            "#ededee",
      cursor:                "#e07020",
      cursorAccent:          "#0a0a0b",
      selectionBackground:   "rgba(224, 112, 32, 0.25)",
      selectionForeground:   "#ededee",
      black:                 "#0a0a0b",
      brightBlack:           "#7e7e86",
      white:                 "#ededee",
      brightWhite:           "#ffffff",
    },
  },

  arctic: {
    label: "Arctic",
    accent: "#0ea5c0",
    css: {
      "--bg-base":            "#0a0a0e",
      "--bg-surface":         "#0f1013",
      "--bg-elevated":        "#151619",
      "--bg-overlay":         "#1a1c1f",
      "--border-subtle":      "#1b1d21",
      "--border-visible":     "#24272c",
      "--text-primary":       "#ebedee",
      "--text-secondary":     "#949a9e",
      "--text-tertiary":      "#7a8186",
      "--accent":             "#0ea5c0",
      "--accent-muted":       "rgba(14, 165, 192, 0.15)",
      "--accent-text":        "#56d0e0",
      "--accent-hover":       "#0c8ea6",
      "--accent-muted-hover": "rgba(14, 165, 192, 0.25)",
      "--terminal-border":    "#24272c",
    },
    xterm: {
      background:            "#0a0a0e",
      foreground:            "#ebedee",
      cursor:                "#0ea5c0",
      cursorAccent:          "#0a0a0e",
      selectionBackground:   "rgba(14, 165, 192, 0.25)",
      selectionForeground:   "#ebedee",
      black:                 "#0a0a0e",
      brightBlack:           "#7a8186",
      white:                 "#ebedee",
      brightWhite:           "#ffffff",
    },
  },

  forest: {
    label: "Forest",
    accent: "#2ea04e",
    css: {
      "--bg-base":            "#0a0a0b",
      "--bg-surface":         "#101012",
      "--bg-elevated":        "#161618",
      "--bg-overlay":         "#1b1b1e",
      "--border-subtle":      "#1c1c1f",
      "--border-visible":     "#26262b",
      "--text-primary":       "#ededee",
      "--text-secondary":     "#9898a0",
      "--text-tertiary":      "#7e7e86",
      "--accent":             "#2ea04e",
      "--accent-muted":       "rgba(46, 160, 78, 0.15)",
      "--accent-text":        "#5cc878",
      "--accent-hover":       "#268a40",
      "--accent-muted-hover": "rgba(46, 160, 78, 0.25)",
      "--terminal-border":    "#26262b",
    },
    xterm: {
      background:            "#0a0a0b",
      foreground:            "#ededee",
      cursor:                "#2ea04e",
      cursorAccent:          "#0a0a0b",
      selectionBackground:   "rgba(46, 160, 78, 0.25)",
      selectionForeground:   "#ededee",
      black:                 "#0a0a0b",
      brightBlack:           "#7e7e86",
      white:                 "#ededee",
      brightWhite:           "#ffffff",
    },
  },

  crimson: {
    label: "Crimson",
    accent: "#dc2626",
    css: {
      "--bg-base":            "#0a0a0b",
      "--bg-surface":         "#101012",
      "--bg-elevated":        "#161618",
      "--bg-overlay":         "#1b1b1e",
      "--border-subtle":      "#1c1c1f",
      "--border-visible":     "#26262b",
      "--text-primary":       "#ededee",
      "--text-secondary":     "#9898a0",
      "--text-tertiary":      "#7e7e86",
      "--accent":             "#dc2626",
      "--accent-muted":       "rgba(220, 38, 38, 0.15)",
      "--accent-text":        "#f87171",
      "--accent-hover":       "#b91c1c",
      "--accent-muted-hover": "rgba(220, 38, 38, 0.25)",
      "--terminal-border":    "#26262b",
    },
    xterm: {
      background:            "#0a0a0b",
      foreground:            "#ededee",
      cursor:                "#dc2626",
      cursorAccent:          "#0a0a0b",
      selectionBackground:   "rgba(220, 38, 38, 0.25)",
      selectionForeground:   "#ededee",
      black:                 "#0a0a0b",
      brightBlack:           "#7e7e86",
      white:                 "#ededee",
      brightWhite:           "#ffffff",
    },
  },
  sakura: {
    label: "Sakura",
    accent: "#e84393",
    css: {
      "--bg-base":            "#0a0a0b",
      "--bg-surface":         "#101012",
      "--bg-elevated":        "#161618",
      "--bg-overlay":         "#1b1b1e",
      "--border-subtle":      "#1c1c1f",
      "--border-visible":     "#26262b",
      "--text-primary":       "#ededee",
      "--text-secondary":     "#9898a0",
      "--text-tertiary":      "#7e7e86",
      "--accent":             "#e84393",
      "--accent-muted":       "rgba(232, 67, 147, 0.15)",
      "--accent-text":        "#f278b4",
      "--accent-hover":       "#c8357e",
      "--accent-muted-hover": "rgba(232, 67, 147, 0.25)",
      "--terminal-border":    "#26262b",
    },
    xterm: {
      background:            "#0a0a0b",
      foreground:            "#ededee",
      cursor:                "#e84393",
      cursorAccent:          "#0a0a0b",
      selectionBackground:   "rgba(232, 67, 147, 0.25)",
      selectionForeground:   "#ededee",
      black:                 "#0a0a0b",
      brightBlack:           "#7e7e86",
      white:                 "#ededee",
      brightWhite:           "#ffffff",
    },
  },

  amber: {
    label: "Amber",
    accent: "#d4a017",
    css: {
      "--bg-base":            "#0a0a0b",
      "--bg-surface":         "#101012",
      "--bg-elevated":        "#161618",
      "--bg-overlay":         "#1b1b1e",
      "--border-subtle":      "#1c1c1f",
      "--border-visible":     "#26262b",
      "--text-primary":       "#ededee",
      "--text-secondary":     "#9898a0",
      "--text-tertiary":      "#7e7e86",
      "--accent":             "#d4a017",
      "--accent-muted":       "rgba(212, 160, 23, 0.15)",
      "--accent-text":        "#e8c04a",
      "--accent-hover":       "#b88a12",
      "--accent-muted-hover": "rgba(212, 160, 23, 0.25)",
      "--terminal-border":    "#26262b",
    },
    xterm: {
      background:            "#0a0a0b",
      foreground:            "#ededee",
      cursor:                "#d4a017",
      cursorAccent:          "#0a0a0b",
      selectionBackground:   "rgba(212, 160, 23, 0.25)",
      selectionForeground:   "#ededee",
      black:                 "#0a0a0b",
      brightBlack:           "#7e7e86",
      white:                 "#ededee",
      brightWhite:           "#ffffff",
    },
  },
};

export const THEME_OPTIONS: Array<{ label: string; value: ThemeName; accent: string }> =
  (Object.keys(THEMES) as ThemeName[]).map((key) => ({
    label: THEMES[key].label,
    value: key,
    accent: THEMES[key].accent,
  }));

export function applyThemeToDOM(themeName: ThemeName): void {
  const theme = THEMES[themeName] ?? THEMES.midnight;
  const root = document.documentElement;
  for (const [prop, value] of Object.entries(theme.css)) {
    root.style.setProperty(prop, value);
  }
}

const THEME_NAMES: ThemeName[] = Object.keys(THEMES) as ThemeName[];

/* ------------------------------------------------------------------ */
/*  Syntax Highlighting Themes                                        */
/* ------------------------------------------------------------------ */

interface SyntaxPalette {
  keyword: string;
  function: string;
  string: string;
  number: string;
  comment: string;
  regexp: string;
  meta: string;
  name: string;
}

interface SyntaxThemeDefinition {
  label: string;
  palette: SyntaxPalette;
}

export const SYNTAX_THEMES: Record<SyntaxThemeName, SyntaxThemeDefinition> = {
  "github-dark": {
    label: "GitHub Dark",
    palette: {
      keyword:  "#ff7b72",
      function: "#d2a8ff",
      string:   "#a5d6ff",
      number:   "#79c0ff",
      comment:  "#8b949e",
      regexp:   "#7ee787",
      meta:     "#8b949e",
      name:     "#7ee787",
    },
  },
  monokai: {
    label: "Monokai",
    palette: {
      keyword:  "#f92672",
      function: "#a6e22e",
      string:   "#e6db74",
      number:   "#ae81ff",
      comment:  "#75715e",
      regexp:   "#e6db74",
      meta:     "#75715e",
      name:     "#f8f8f2",
    },
  },
  "tokyo-night": {
    label: "Tokyo Night",
    palette: {
      keyword:  "#bb9af7",
      function: "#7aa2f7",
      string:   "#9ece6a",
      number:   "#ff9e64",
      comment:  "#565f89",
      regexp:   "#b4f9f8",
      meta:     "#565f89",
      name:     "#73daca",
    },
  },
};

export const SYNTAX_THEME_OPTIONS: Array<{ label: string; value: SyntaxThemeName }> =
  (Object.keys(SYNTAX_THEMES) as SyntaxThemeName[]).map((key) => ({
    label: SYNTAX_THEMES[key].label,
    value: key,
  }));

export function applySyntaxThemeToDOM(themeName: SyntaxThemeName): void {
  const theme = SYNTAX_THEMES[themeName] ?? SYNTAX_THEMES["github-dark"];
  const root = document.documentElement;
  for (const [token, color] of Object.entries(theme.palette)) {
    root.style.setProperty(`--hljs-${token}`, color);
  }
}

/** Pick the least-used theme among existing projects. */
export function getNextProjectTheme(existingProjects: Array<{ theme: ThemeName }>): ThemeName {
  const counts = new Map<ThemeName, number>(THEME_NAMES.map((t) => [t, 0]));
  for (const p of existingProjects) {
    counts.set(p.theme, (counts.get(p.theme) ?? 0) + 1);
  }
  let min = Infinity;
  let pick: ThemeName = "midnight";
  for (const [name, count] of counts) {
    if (count < min) {
      min = count;
      pick = name;
    }
  }
  return pick;
}
