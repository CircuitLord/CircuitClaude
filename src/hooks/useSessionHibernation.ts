import { useEffect } from "react";
import { hibernatePtySession } from "../lib/pty";
import { loadTrackedPiSession } from "../lib/piSessionTracking";
import { isRemotePath } from "../lib/remote";
import { isPiTerminalSession } from "../lib/sessionTypes";
import { useSessionStore } from "../stores/sessionStore";

const HIBERNATE_AFTER_MS = 30 * 60 * 1000;
const HIBERNATE_CHECK_MS = 60 * 1000;

function getVisibleSessionIds(): Set<string> {
  const state = useSessionStore.getState();
  const visible = new Set<string>();
  if (!state.activeProjectPath) return visible;

  const split = state.projectSplits.get(state.activeProjectPath);
  if (split) {
    visible.add(split.pane1.activeSessionId);
    visible.add(split.pane2.activeSessionId);
  } else if (state.activeSessionId) {
    visible.add(state.activeSessionId);
  }
  return visible;
}

async function hibernateIdlePiSessions(): Promise<void> {
  const state = useSessionStore.getState();
  const visible = getVisibleSessionIds();
  const cutoff = Date.now() - HIBERNATE_AFTER_MS;
  const candidates = state.sessions.filter((session) =>
    session.sessionId
    && !session.isDormant
    && !visible.has(session.id)
    && !state.tabStatuses.has(session.id)
    && (state.lastActivity.get(session.id) ?? session.createdAt) <= cutoff
    && isPiTerminalSession(session.sessionType)
    && !isRemotePath(session.projectPath)
  );

  for (const candidate of candidates) {
    const current = useSessionStore.getState();
    const session = current.sessions.find((entry) => entry.id === candidate.id);
    if (!session?.sessionId || session.isDormant || current.tabStatuses.has(session.id) || getVisibleSessionIds().has(session.id)) continue;

    const tracked = await loadTrackedPiSession(session.id);
    if (!tracked?.sessionFile) continue;
    await hibernatePtySession(session.sessionId);
    useSessionStore.getState().hibernateSession(session.id);
  }
}

export function useSessionHibernation(): void {
  useEffect(() => {
    let running = false;
    const timer = setInterval(() => {
      if (running) return;
      running = true;
      hibernateIdlePiSessions().finally(() => {
        running = false;
      });
    }, HIBERNATE_CHECK_MS);
    return () => clearInterval(timer);
  }, []);
}
