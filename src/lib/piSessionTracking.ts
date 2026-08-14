import { invoke } from "@tauri-apps/api/core";
import { appConfigDir, join } from "@tauri-apps/api/path";

export interface TrackedPiSession {
  sessionId: string;
  sessionFile?: string;
}

export async function getPiSessionTrackingArgs(tabId: string): Promise<string> {
  const configDir = await appConfigDir();
  const statePath = await join(configDir, "session-tracking", `${tabId}.json`);
  return `--cc-session-state ${statePath}`;
}

export function loadTrackedPiSession(tabId: string): Promise<TrackedPiSession | null> {
  return invoke<TrackedPiSession | null>("load_tracked_pi_session", { tabId });
}
