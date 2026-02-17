import { invoke } from "@tauri-apps/api/core";

const DEFAULT_MAX_CHARS = 40;
const PROMPT_LIMIT = 3;
const CONTEXT_CHAR_BUDGET = 400;

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
      contextCharBudget: CONTEXT_CHAR_BUDGET,
    });
    const clean = title.trim();
    return clean.length > 0 ? clean : null;
  } catch {
    return null;
  }
}
