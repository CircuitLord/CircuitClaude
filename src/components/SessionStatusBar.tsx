import { useConversationStore } from "../stores/conversationStore";
import type { SessionStats, SessionType } from "../types";

interface SessionStatusBarProps {
  tabId: string;
  sessionType: SessionType;
}

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "m";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return String(n);
}

function formatDuration(ms: number): string {
  const secs = Math.round(ms / 1000);
  if (secs < 60) return secs + "s";
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return mins + "m" + (rem > 0 ? rem + "s" : "");
}

export function SessionStatusBar({ tabId, sessionType }: SessionStatusBarProps) {
  const stats: SessionStats | undefined = useConversationStore(
    (s) => s.sessionStats.get(tabId)
  );

  if (sessionType === "shell" || sessionType === "opencode") return null;

  if (!stats || !stats.model) {
    return (
      <div className="session-status-bar">
        <span className="session-status-bar-empty">awaiting first message...</span>
      </div>
    );
  }

  const totalTokens = stats.inputTokens + stats.outputTokens + stats.cacheReadTokens + stats.cacheCreationTokens;

  return (
    <div className="session-status-bar">
      <span className="session-status-bar-model">{stats.model}</span>
      <span className="session-status-bar-sep">|</span>
      <span className="session-status-bar-stat">
        {formatTokenCount(totalTokens)}
        {stats.contextWindow > 0 && <> / {formatTokenCount(stats.contextWindow)}</>}
        {" tokens"}
      </span>
      <span className="session-status-bar-sep">|</span>
      <span className="session-status-bar-stat">
        {stats.turns} {stats.turns === 1 ? "turn" : "turns"}
      </span>
      <span className="session-status-bar-sep">|</span>
      <span className="session-status-bar-stat">{formatDuration(stats.durationMs)}</span>
    </div>
  );
}
