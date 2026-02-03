import type { ITheme } from "@xterm/xterm";
import type { ThemeName } from "../types";

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
      "--bg-base":            "#0b0a0a",
      "--bg-surface":         "#111010",
      "--bg-elevated":        "#181616",
      "--bg-overlay":         "#1d1b1a",
      "--border-subtle":      "#1e1c1a",
      "--border-visible":     "#2a2724",
      "--text-primary":       "#ededeb",
      "--text-secondary":     "#9e9894",
      "--text-tertiary":      "#857e78",
      "--accent":             "#e07020",
      "--accent-muted":       "rgba(224, 112, 32, 0.15)",
      "--accent-text":        "#f0a060",
      "--accent-hover":       "#c06018",
      "--accent-muted-hover": "rgba(224, 112, 32, 0.25)",
      "--terminal-border":    "#2a2724",
    },
    xterm: {
      background:            "#0b0a0a",
      foreground:            "#ededeb",
      cursor:                "#e07020",
      cursorAccent:          "#0b0a0a",
      selectionBackground:   "rgba(224, 112, 32, 0.25)",
      selectionForeground:   "#ededeb",
      black:                 "#0b0a0a",
      brightBlack:           "#857e78",
      white:                 "#ededeb",
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
      "--bg-base":            "#0a0b0a",
      "--bg-surface":         "#0f110f",
      "--bg-elevated":        "#161816",
      "--bg-overlay":         "#1b1d1b",
      "--border-subtle":      "#1c1e1c",
      "--border-visible":     "#262926",
      "--text-primary":       "#ecedec",
      "--text-secondary":     "#959c95",
      "--text-tertiary":      "#7b857b",
      "--accent":             "#2ea04e",
      "--accent-muted":       "rgba(46, 160, 78, 0.15)",
      "--accent-text":        "#5cc878",
      "--accent-hover":       "#268a40",
      "--accent-muted-hover": "rgba(46, 160, 78, 0.25)",
      "--terminal-border":    "#262926",
    },
    xterm: {
      background:            "#0a0b0a",
      foreground:            "#ecedec",
      cursor:                "#2ea04e",
      cursorAccent:          "#0a0b0a",
      selectionBackground:   "rgba(46, 160, 78, 0.25)",
      selectionForeground:   "#ecedec",
      black:                 "#0a0b0a",
      brightBlack:           "#7b857b",
      white:                 "#ecedec",
      brightWhite:           "#ffffff",
    },
  },

  crimson: {
    label: "Crimson",
    accent: "#dc2626",
    css: {
      "--bg-base":            "#0b0a0a",
      "--bg-surface":         "#111010",
      "--bg-elevated":        "#181616",
      "--bg-overlay":         "#1d1b1b",
      "--border-subtle":      "#1e1c1c",
      "--border-visible":     "#2a2626",
      "--text-primary":       "#edecec",
      "--text-secondary":     "#9e9696",
      "--text-tertiary":      "#857c7c",
      "--accent":             "#dc2626",
      "--accent-muted":       "rgba(220, 38, 38, 0.15)",
      "--accent-text":        "#f87171",
      "--accent-hover":       "#b91c1c",
      "--accent-muted-hover": "rgba(220, 38, 38, 0.25)",
      "--terminal-border":    "#2a2626",
    },
    xterm: {
      background:            "#0b0a0a",
      foreground:            "#edecec",
      cursor:                "#dc2626",
      cursorAccent:          "#0b0a0a",
      selectionBackground:   "rgba(220, 38, 38, 0.25)",
      selectionForeground:   "#edecec",
      black:                 "#0b0a0a",
      brightBlack:           "#857c7c",
      white:                 "#edecec",
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
