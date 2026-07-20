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

export function supportsAgentSessionResume(sessionType: string): boolean {
  return sessionType === "claude" || sessionType === "pi" || sessionType === PI_CHAT_SESSION_TYPE.id;
}

export function getSessionCommand(
  sessionType: string,
  agentSessionId?: string,
  resumeSession = false,
): string {
  const config = getSessionTypeConfig(sessionType);
  const command = config?.command ?? sessionType;
  if (!agentSessionId) return command;

  switch (sessionType) {
    case "claude":
      return resumeSession
        ? `${command} --resume ${agentSessionId}`
        : `${command} --session-id ${agentSessionId}`;
    case "pi":
      return `${command} --session-id ${agentSessionId}`;
    default:
      return command;
  }
}

export function getSessionDisplayName(sessionType: string): string {
  const config = getSessionTypeConfig(sessionType);
  return config?.name ?? sessionType;
}
