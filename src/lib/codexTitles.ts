import { invoke } from "@tauri-apps/api/core";

const DEFAULT_MAX_CHARS = 40;
const PROMPT_LIMIT = 1;

export async function regenerateCodexTitle(
  projectPath: string,
  spawnedAtMs: number,
  maxChars: number = DEFAULT_MAX_CHARS,
): Promise<string | null> {
  try {
    const title = await invoke<string>("generate_codex_title", {
      projectPath,
      spawnedAtMs,
      maxChars,
      promptLimit: PROMPT_LIMIT,
    });
    const clean = title.trim();
    return clean.length > 0 ? clean : null;
  } catch {
    return null;
  }
}
