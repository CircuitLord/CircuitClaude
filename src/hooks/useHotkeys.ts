import { useEffect } from "react";
import { useSessionStore } from "../stores/sessionStore";
import { spawnNewSession } from "../lib/sessions";

export function useHotkeys() {
  const sessions = useSessionStore((s) => s.sessions);
  const activeProjectPath = useSessionStore((s) => s.activeProjectPath);
  const setActiveSession = useSessionStore((s) => s.setActiveSession);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Skip when dialog/overlay is open
      if (document.querySelector(".dialog-overlay") || document.querySelector(".diff-overlay")) return;
      // Skip if focus is in an input/textarea (but not xterm's internal textarea)
      const target = e.target as HTMLElement;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "SELECT") return;
      if (tag === "TEXTAREA" && !target.closest(".xterm") && !target.closest(".conversation-input-area")) return;
      if (target.closest(".prompt-input")) return;

      // Ctrl+T — new session
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key === "t") {
        e.preventDefault();
        spawnNewSession();
        return;
      }

      // Ctrl+1-9 — switch tab by index
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key >= "1" && e.key <= "9") {
        e.preventDefault();
        if (!activeProjectPath) return;
        const confirmed = sessions.filter(
          (s) => s.projectPath === activeProjectPath && !s.restorePending
        );
        const index = parseInt(e.key, 10) - 1;
        if (index < confirmed.length) {
          setActiveSession(confirmed[index].id);
        }
        return;
      }
    }

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [sessions, activeProjectPath, setActiveSession]);
}
