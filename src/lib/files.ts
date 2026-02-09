import { invoke } from "@tauri-apps/api/core";
import { FileTreeEntry } from "../types";

export function readDirectory(
  projectPath: string,
  dirPath?: string,
): Promise<FileTreeEntry[]> {
  return invoke<FileTreeEntry[]>("read_directory", {
    projectPath,
    dirPath: dirPath ?? null,
  });
}
