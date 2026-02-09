import { useEffect } from "react";
import { useSessionStore } from "../stores/sessionStore";
import { useProjectStore } from "../stores/projectStore";
import { useNotesStore } from "../stores/notesStore";
import { spawnNewSession } from "../lib/sessions";

export function useHotkeys() {
  const sessions = useSessionStore((s) => s.sessions);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const activeProjectPath = useSessionStore((s) => s.activeProjectPath);
  const setActiveSession = useSessionStore((s) => s.setActiveSession);
  const setActiveProject = useSessionStore((s) => s.setActiveProject);
  const projects = useProjectStore((s) => s.projects);

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

      // Ctrl+N — toggle notes
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key === "n") {
        e.preventDefault();
        if (!activeProjectPath) return;
        const notesStore = useNotesStore.getState();
        if (notesStore.isOpen) {
          notesStore.close();
        } else {
          notesStore.open(activeProjectPath);
        }
        return;
      }

      // Ctrl+1-9 — switch tab by index
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key >= "1" && e.key <= "9") {
        e.preventDefault();
        if (!activeProjectPath) return;
        const confirmed = sessions.filter(
          (s) => s.projectPath === activeProjectPath
        );
        const index = parseInt(e.key, 10) - 1;
        if (index < confirmed.length) {
          setActiveSession(confirmed[index].id);
        }
        return;
      }

      // Ctrl+Left/Right — cycle tabs within current project
      if (e.ctrlKey && !e.shiftKey && !e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        e.preventDefault();
        if (!activeProjectPath) return;
        const projectSessions = sessions.filter(
          (s) => s.projectPath === activeProjectPath
        );
        if (projectSessions.length <= 1) return;
        const currentIndex = projectSessions.findIndex((s) => s.id === activeSessionId);
        const delta = e.key === "ArrowRight" ? 1 : -1;
        const nextIndex = (currentIndex + delta + projectSessions.length) % projectSessions.length;
        setActiveSession(projectSessions[nextIndex].id);
        return;
      }

      // Ctrl+Up/Down — cycle between projects
      if (e.ctrlKey && !e.shiftKey && !e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        if (projects.length <= 1) return;
        const currentIndex = projects.findIndex((p) => p.path === activeProjectPath);
        const delta = e.key === "ArrowDown" ? 1 : -1;
        const nextIndex = (currentIndex + delta + projects.length) % projects.length;
        setActiveProject(projects[nextIndex].path);
        return;
      }
    }

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [sessions, activeSessionId, activeProjectPath, setActiveSession, setActiveProject, projects]);
}
