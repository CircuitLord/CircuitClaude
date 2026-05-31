import { useSettingsStore } from "../stores/settingsStore";
import { PI_CHAT_SESSION_TYPE } from "../types";
import type { SessionTypeConfig } from "../types";

export function getSessionTypes(editableTypes = useSettingsStore.getState().settings.sessionTypes): SessionTypeConfig[] {
  return editableTypes.some((type) => type.id === PI_CHAT_SESSION_TYPE.id)
    ? editableTypes
    : [...editableTypes, PI_CHAT_SESSION_TYPE];
}

export function getSessionTypeConfig(id: string): SessionTypeConfig | undefined {
  return getSessionTypes().find((t) => t.id === id);
}

export function getTabPrefix(sessionType: string): string {
  if (sessionType === "editor") return "#";
  const config = getSessionTypeConfig(sessionType);
  return config?.prefix ?? ">";
}

export function getSessionCommand(sessionType: string): string {
  const config = getSessionTypeConfig(sessionType);
  return config?.command ?? sessionType;
}

export function getSessionDisplayName(sessionType: string): string {
  const config = getSessionTypeConfig(sessionType);
  return config?.name ?? sessionType;
}
