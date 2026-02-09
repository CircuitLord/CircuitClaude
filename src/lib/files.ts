import { invoke } from "@tauri-apps/api/core";
import { FileTreeEntry } from "../types";

/** Extension-based color classes for file names */
const EXT_COLORS: Record<string, string> = {
  // Code — primary text, no special color
  ts: "file-ext-code",
  tsx: "file-ext-code",
  js: "file-ext-code",
  jsx: "file-ext-code",
  rs: "file-ext-code",
  py: "file-ext-code",
  go: "file-ext-code",
  java: "file-ext-code",
  c: "file-ext-code",
  cpp: "file-ext-code",
  h: "file-ext-code",
  rb: "file-ext-code",
  swift: "file-ext-code",
  kt: "file-ext-code",
  cs: "file-ext-code",
  // Markup / styles
  html: "file-ext-markup",
  css: "file-ext-markup",
  scss: "file-ext-markup",
  less: "file-ext-markup",
  svg: "file-ext-markup",
  // Data / config — dimmed
  json: "file-ext-config",
  yaml: "file-ext-config",
  yml: "file-ext-config",
  toml: "file-ext-config",
  ini: "file-ext-config",
  env: "file-ext-config",
  lock: "file-ext-config",
  // Docs — dimmed
  md: "file-ext-doc",
  txt: "file-ext-doc",
  rst: "file-ext-doc",
  // Images — dimmed
  png: "file-ext-media",
  jpg: "file-ext-media",
  jpeg: "file-ext-media",
  gif: "file-ext-media",
  ico: "file-ext-media",
  webp: "file-ext-media",
  mp4: "file-ext-media",
  mp3: "file-ext-media",
};

/** Special whole-filename matches for dotfiles and lockfiles */
const NAME_COLORS: Record<string, string> = {
  ".gitignore": "file-ext-config",
  ".eslintrc": "file-ext-config",
  ".prettierrc": "file-ext-config",
  "Cargo.lock": "file-ext-config",
  "package-lock.json": "file-ext-config",
  "yarn.lock": "file-ext-config",
  "pnpm-lock.yaml": "file-ext-config",
  "Dockerfile": "file-ext-config",
  ".dockerignore": "file-ext-config",
  "LICENSE": "file-ext-doc",
  "README": "file-ext-doc",
};

export function fileColorClass(filename: string): string {
  // Check exact name first
  const nameClass = NAME_COLORS[filename];
  if (nameClass) return nameClass;

  // Dotfiles are config/data
  if (filename.startsWith(".")) return "file-ext-config";

  const dot = filename.lastIndexOf(".");
  if (dot === -1) return "";

  const ext = filename.slice(dot + 1).toLowerCase();
  return EXT_COLORS[ext] ?? "";
}

export function readDirectory(
  projectPath: string,
  dirPath?: string,
): Promise<FileTreeEntry[]> {
  return invoke<FileTreeEntry[]>("read_directory", {
    projectPath,
    dirPath: dirPath ?? null,
  });
}
