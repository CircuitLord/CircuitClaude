import { useSettingsStore } from "../stores/settingsStore";
import { isRemotePath } from "./remote";
import { PI_CHAT_SESSION_TYPE } from "../types";
import type { SessionTypeConfig } from "../types";

export function getSessionTypes(editableTypes = useSettingsStore.getState().settings.sessionTypes): SessionTypeConfig[] {
  return editableTypes.some((type) => type.id === PI_CHAT_SESSION_TYPE.id)
    ? editableTypes
    : [...editableTypes, PI_CHAT_SESSION_TYPE];
}

/** Session types a project can actually run — pi chat drives a local process, so remotes can't use it. */
export function getProjectSessionTypes(
  projectPath: string | null,
  editableTypes?: SessionTypeConfig[],
): SessionTypeConfig[] {
  const types = editableTypes ? getSessionTypes(editableTypes) : getSessionTypes();
  if (projectPath && isRemotePath(projectPath)) {
    return types.filter((type) => type.id !== PI_CHAT_SESSION_TYPE.id);
  }
  return types;
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
  const strategy = getSessionTypeConfig(sessionType)?.resumeStrategy;
  return strategy === "claude" || strategy === "pi";
}

export function isPiTerminalSession(sessionType: string): boolean {
  return sessionType !== PI_CHAT_SESSION_TYPE.id && getSessionTypeConfig(sessionType)?.resumeStrategy === "pi";
}

interface SessionCommandOptions {
  agentSessionId?: string;
  agentSessionPath?: string;
  resumeSession?: boolean;
  additionalArgs?: string;
}

export function getSessionCommand(sessionType: string, options: SessionCommandOptions): string {
  const config = getSessionTypeConfig(sessionType);
  const command = options.additionalArgs ? `${config?.command ?? sessionType} ${options.additionalArgs}` : config?.command ?? sessionType;
  if (!options.agentSessionId) return command;

  switch (config?.resumeStrategy) {
    case "claude":
      return options.resumeSession
        ? `${command} --resume ${options.agentSessionId}`
        : `${command} --session-id ${options.agentSessionId}`;
    case "pi":
      return options.resumeSession && options.agentSessionPath
        ? `${command} --session ${options.agentSessionPath}`
        : `${command} --session-id ${options.agentSessionId}`;
    default:
      return command;
  }
}

export function getSessionDisplayName(sessionType: string): string {
  const config = getSessionTypeConfig(sessionType);
  return config?.name ?? sessionType;
}
