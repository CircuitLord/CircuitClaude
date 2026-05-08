import { useSettingsStore } from "../stores/settingsStore";
import type { SessionTypeConfig } from "../types";

export function getSessionTypes(): SessionTypeConfig[] {
  return useSettingsStore.getState().settings.sessionTypes;
}

export function getSessionTypeConfig(id: string): SessionTypeConfig | undefined {
  return getSessionTypes().find((t) => t.id === id);
}

export function getTabPrefix(sessionType: string): string {
  if (sessionType === "editor") return "#";
  const config = getSessionTypeConfig(sessionType);
  return config?.prefix ?? ">";
}

export function supportsStatusBar(sessionType: string): boolean {
  return sessionType === "claude";
}

export function getSessionCommand(sessionType: string): string {
  const config = getSessionTypeConfig(sessionType);
  return config?.command ?? sessionType;
}

export function getSessionDisplayName(sessionType: string): string {
  const config = getSessionTypeConfig(sessionType);
  return config?.name ?? sessionType;
}
