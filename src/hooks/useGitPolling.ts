import { useEffect } from "react";
import { useGitStore } from "../stores/gitStore";
import { useSessionStore } from "../stores/sessionStore";

const POLL_INTERVAL = 7000;

// poll git status for the active project regardless of which right panel tab is open
export function useGitPolling() {
  const activeProjectPath = useSessionStore((s) => s.activeProjectPath);
  const fetchStatus = useGitStore((s) => s.fetchStatus);

  useEffect(() => {
    if (!activeProjectPath) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = () => {
      fetchStatus(activeProjectPath).finally(() => {
        if (cancelled) return;
        timer = setTimeout(poll, POLL_INTERVAL);
      });
    };
    poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [activeProjectPath, fetchStatus]);
}
