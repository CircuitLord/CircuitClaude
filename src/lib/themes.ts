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
      "--bg-base":            "#09090f",
      "--bg-surface":         "#0f0f17",
      "--bg-elevated":        "#15151f",
      "--bg-overlay":         "#1a1a26",
      "--border-subtle":      "#1a1a26",
      "--border-visible":     "#24242e",
      "--text-primary":       "#ededf0",
      "--text-secondary":     "#9898a6",
      "--text-tertiary":      "#7e7e8e",
      "--accent":             "#7c3aed",
      "--accent-muted":       "rgba(124, 58, 237, 0.15)",
      "--accent-text":        "#a78bfa",
      "--accent-hover":       "#6d28d9",
      "--accent-muted-hover": "rgba(124, 58, 237, 0.25)",
      "--terminal-border":    "#2e2e3a",
    },
    xterm: {
      background:            "#09090f",
      foreground:            "#ededf0",
      cursor:                "#7c3aed",
      cursorAccent:          "#09090f",
      selectionBackground:   "rgba(124, 58, 237, 0.25)",
      selectionForeground:   "#ededf0",
      black:                 "#09090f",
      brightBlack:           "#7e7e8e",
      white:                 "#ededf0",
      brightWhite:           "#ffffff",
    },
  },

  ember: {
    label: "Ember",
    accent: "#e07020",
    css: {
      "--bg-base":            "#0f0a08",
      "--bg-surface":         "#161009",
      "--bg-elevated":        "#1e1710",
      "--bg-overlay":         "#261e16",
      "--border-subtle":      "#261e16",
      "--border-visible":     "#342a1e",
      "--text-primary":       "#f0ece8",
      "--text-secondary":     "#a69888",
      "--text-tertiary":      "#8e7e6e",
      "--accent":             "#e07020",
      "--accent-muted":       "rgba(224, 112, 32, 0.15)",
      "--accent-text":        "#f0a060",
      "--accent-hover":       "#c06018",
      "--accent-muted-hover": "rgba(224, 112, 32, 0.25)",
      "--terminal-border":    "#342a1e",
    },
    xterm: {
      background:            "#0f0a08",
      foreground:            "#f0ece8",
      cursor:                "#e07020",
      cursorAccent:          "#0f0a08",
      selectionBackground:   "rgba(224, 112, 32, 0.25)",
      selectionForeground:   "#f0ece8",
      black:                 "#0f0a08",
      brightBlack:           "#8e7e6e",
      white:                 "#f0ece8",
      brightWhite:           "#ffffff",
    },
  },

  arctic: {
    label: "Arctic",
    accent: "#0ea5c0",
    css: {
      "--bg-base":            "#080c0f",
      "--bg-surface":         "#0c1216",
      "--bg-elevated":        "#111a1f",
      "--bg-overlay":         "#162026",
      "--border-subtle":      "#162026",
      "--border-visible":     "#1e2e34",
      "--text-primary":       "#e8f0f0",
      "--text-secondary":     "#88a0a6",
      "--text-tertiary":      "#6e8890",
      "--accent":             "#0ea5c0",
      "--accent-muted":       "rgba(14, 165, 192, 0.15)",
      "--accent-text":        "#56d0e0",
      "--accent-hover":       "#0c8ea6",
      "--accent-muted-hover": "rgba(14, 165, 192, 0.25)",
      "--terminal-border":    "#1e2e34",
    },
    xterm: {
      background:            "#080c0f",
      foreground:            "#e8f0f0",
      cursor:                "#0ea5c0",
      cursorAccent:          "#080c0f",
      selectionBackground:   "rgba(14, 165, 192, 0.25)",
      selectionForeground:   "#e8f0f0",
      black:                 "#080c0f",
      brightBlack:           "#6e8890",
      white:                 "#e8f0f0",
      brightWhite:           "#ffffff",
    },
  },

  forest: {
    label: "Forest",
    accent: "#2ea04e",
    css: {
      "--bg-base":            "#080d08",
      "--bg-surface":         "#0c140c",
      "--bg-elevated":        "#111c12",
      "--bg-overlay":         "#162418",
      "--border-subtle":      "#162418",
      "--border-visible":     "#1e3020",
      "--text-primary":       "#e8f0e8",
      "--text-secondary":     "#88a688",
      "--text-tertiary":      "#6e8e6e",
      "--accent":             "#2ea04e",
      "--accent-muted":       "rgba(46, 160, 78, 0.15)",
      "--accent-text":        "#5cc878",
      "--accent-hover":       "#268a40",
      "--accent-muted-hover": "rgba(46, 160, 78, 0.25)",
      "--terminal-border":    "#1e3020",
    },
    xterm: {
      background:            "#080d08",
      foreground:            "#e8f0e8",
      cursor:                "#2ea04e",
      cursorAccent:          "#080d08",
      selectionBackground:   "rgba(46, 160, 78, 0.25)",
      selectionForeground:   "#e8f0e8",
      black:                 "#080d08",
      brightBlack:           "#6e8e6e",
      white:                 "#e8f0e8",
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
