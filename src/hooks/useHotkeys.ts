import { useEffect, useRef } from "react";
import { useSessionStore } from "../stores/sessionStore";
import { useProjectStore } from "../stores/projectStore";
import { useNotesStore } from "../stores/notesStore";
import { spawnNewSession } from "../lib/sessions";
import { regenerateCodexTitle } from "../lib/codexTitles";
import { writeSession } from "../lib/pty";
import { voiceInputController, type VoiceInputState } from "../lib/voiceInput";
import { useVoiceStore } from "../stores/voiceStore";
import { useSettingsStore } from "../stores/settingsStore";
import type { SessionType } from "../types";

function isCtrlSpaceHotkey(e: KeyboardEvent): boolean {
  return (
    e.ctrlKey &&
    !e.shiftKey &&
    !e.altKey &&
    !e.metaKey &&
    (e.code === "Space" || e.key === " " || e.key === "Spacebar")
  );
}

export function useHotkeys() {
  const sessions = useSessionStore((s) => s.sessions);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const activeProjectPath = useSessionStore((s) => s.activeProjectPath);
  const setActiveSession = useSessionStore((s) => s.setActiveSession);
  const setActiveProject = useSessionStore((s) => s.setActiveProject);
  const setSessionTitle = useSessionStore((s) => s.setSessionTitle);
  const projects = useProjectStore((s) => s.projects);
  const voiceMicDeviceId = useSettingsStore((s) => s.settings.voiceMicDeviceId);
  const voiceTargetTabIdRef = useRef<string | null>(null);
  const voiceTargetSessionIdRef = useRef<string | null>(null);
  const voiceTargetSessionTypeRef = useRef<SessionType | null>(null);
  const voiceStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastInterimRef = useRef("");
  const voicePreviewRef = useRef("");
  const stopBySubmitRef = useRef(false);
  const stopEditingAfterStopRef = useRef(false);
  const previewWriteTokenRef = useRef(0);
  const voiceWriteQueueRef = useRef(Promise.resolve());
  const textEncoderRef = useRef<TextEncoder>(new TextEncoder());

  function clearVoiceStatusAfter(delayMs = 1800) {
    if (voiceStatusTimerRef.current) {
      clearTimeout(voiceStatusTimerRef.current);
    }
    voiceStatusTimerRef.current = setTimeout(() => {
      useVoiceStore.getState().setIdle();
      voiceStatusTimerRef.current = null;
    }, delayMs);
  }

  function invalidatePendingPreviewWrites() {
    previewWriteTokenRef.current += 1;
  }

  function queueWrite(sessionId: string, data: string, token: number) {
    if (!data) return;
    const bytes = textEncoderRef.current.encode(data);
    voiceWriteQueueRef.current = voiceWriteQueueRef.current
      .then(() => {
        if (token !== previewWriteTokenRef.current) return;
        return writeSession(sessionId, bytes);
      })
      .catch(() => {});
  }

  function queuePreviewUpdate(sessionId: string, nextPreview: string) {

    const prev = voicePreviewRef.current;
    if (nextPreview.length <= prev.length) return;
    // Append-only mode: never rewrite previously inserted preview text.
    const patchText = nextPreview.slice(prev.length);
    const token = previewWriteTokenRef.current;
    if (!patchText) return;
    voicePreviewRef.current = prev + patchText;
    queueWrite(sessionId, patchText, token);
  }

  useEffect(() => {
    voiceInputController.configureHandlers({
      onStateChange: (state: VoiceInputState) => {
        const targetTabId = voiceTargetTabIdRef.current;
        if (state === "listening" && targetTabId) {
          lastInterimRef.current = "";
          voicePreviewRef.current = "";
          stopBySubmitRef.current = false;
          stopEditingAfterStopRef.current = false;
          useVoiceStore.getState().setListening(targetTabId);
          return;
        }
        if (state === "processing") {
          useVoiceStore.getState().setProcessing(targetTabId);
        }
      },
      onInterimTranscript: (transcript: string) => {
        const targetTabId = voiceTargetTabIdRef.current;
        const targetSessionId = voiceTargetSessionIdRef.current;
        if (!targetTabId) return;
        if (stopEditingAfterStopRef.current) return;
        const normalized = transcript.trim();
        if (!normalized) {
          if (lastInterimRef.current !== "") {
            useVoiceStore.getState().setListening(targetTabId);
            lastInterimRef.current = "";
          }
          // Ignore transient empty interim packets. Some recognizers emit
          // empty frames during rescoring/restarts; clearing here can wipe
          // the full draft before the next non-empty interim arrives.
          return;
        }
        if (normalized === lastInterimRef.current) return;
        lastInterimRef.current = normalized;
        if (targetSessionId) {
          queuePreviewUpdate(targetSessionId, normalized);
        }
      },
      onFinalTranscript: (transcript: string) => {
        const targetTabId = voiceTargetTabIdRef.current;
        const targetSessionId = voiceTargetSessionIdRef.current;
        const stoppedBySubmit = stopBySubmitRef.current;
        const stopEditingAfterStop = stopEditingAfterStopRef.current;
        stopBySubmitRef.current = false;
        stopEditingAfterStopRef.current = false;
        lastInterimRef.current = "";
        voiceTargetTabIdRef.current = null;
        voiceTargetSessionIdRef.current = null;
        voiceTargetSessionTypeRef.current = null;

        const normalized = transcript.trim();
        if (!normalized) {
          if (targetSessionId && !stopEditingAfterStop) {
            queuePreviewUpdate(targetSessionId, "");
          } else {
            voicePreviewRef.current = "";
          }
          useVoiceStore.getState().setStatus("no speech detected", targetTabId);
          clearVoiceStatusAfter();
          return;
        }
        if (!targetSessionId) {
          voicePreviewRef.current = "";
          useVoiceStore.getState().setError("no active terminal session", targetTabId);
          clearVoiceStatusAfter();
          return;
        }
        if (stopEditingAfterStop) {
          voicePreviewRef.current = "";
          useVoiceStore.getState().setStatus(
            stoppedBySubmit ? "submitted and stopped listening" : "stopped listening",
            targetTabId
          );
        } else if (!stoppedBySubmit) {
          queuePreviewUpdate(targetSessionId, normalized);
          useVoiceStore.getState().setStatus("inserted transcript", targetTabId);
        } else {
          voicePreviewRef.current = "";
          useVoiceStore.getState().setStatus("submitted and stopped listening", targetTabId);
        }
        clearVoiceStatusAfter();
      },
      onError: (message: string) => {
        const targetTabId = voiceTargetTabIdRef.current;
        const targetSessionId = voiceTargetSessionIdRef.current;
        stopBySubmitRef.current = false;
        const stopEditingAfterStop = stopEditingAfterStopRef.current;
        stopEditingAfterStopRef.current = false;
        lastInterimRef.current = "";
        if (targetSessionId && !stopEditingAfterStop) {
          queuePreviewUpdate(targetSessionId, "");
        } else {
          voicePreviewRef.current = "";
        }
        voiceTargetTabIdRef.current = null;
        voiceTargetSessionIdRef.current = null;
        voiceTargetSessionTypeRef.current = null;
        useVoiceStore.getState().setError(message, targetTabId);
        clearVoiceStatusAfter();
      },
      onInfo: (message: string) => {
        const targetTabId = voiceTargetTabIdRef.current;
        useVoiceStore.getState().setStatus(message, targetTabId);
      },
    });

    return () => {
      voiceInputController.configureHandlers({});
      if (voiceStatusTimerRef.current) {
        clearTimeout(voiceStatusTimerRef.current);
        voiceStatusTimerRef.current = null;
      }
      voicePreviewRef.current = "";
      voiceTargetSessionTypeRef.current = null;
      stopBySubmitRef.current = false;
      stopEditingAfterStopRef.current = false;
      invalidatePendingPreviewWrites();
      useVoiceStore.getState().setIdle();
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Skip when dialog/overlay is open
      if (document.querySelector(".dialog-overlay") || document.querySelector(".diff-overlay")) return;

      // Ctrl+N — toggle notes (before textarea guard so it works in notes textarea)
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key === "n") {
        e.preventDefault();
        if (!activeProjectPath) return;
        useNotesStore.getState().toggle();
        return;
      }

      // Enter — when voice capture is active, stop listening but let Enter submit normally
      if (
        voiceInputController.isListening() &&
        e.key === "Enter" &&
        !e.ctrlKey &&
        !e.shiftKey &&
        !e.altKey &&
        !e.metaKey
      ) {
        stopBySubmitRef.current = true;
        stopEditingAfterStopRef.current = true;
        invalidatePendingPreviewWrites();
        useVoiceStore.getState().setProcessing(voiceTargetTabIdRef.current, "submitting and stopping voice...");
        voiceInputController.stop();
        // Do not preventDefault: Enter should still submit in terminal/input
        return;
      }

      // Ctrl+Space — toggle voice-to-text capture for active terminal session
      if (isCtrlSpaceHotkey(e)) {
        e.preventDefault();

        if (voiceInputController.isListening()) {
          stopBySubmitRef.current = false;
          stopEditingAfterStopRef.current = true;
          invalidatePendingPreviewWrites();
          useVoiceStore.getState().setProcessing(voiceTargetTabIdRef.current);
          voiceInputController.stop();
          return;
        }

        const state = useSessionStore.getState();
        if (!state.activeSessionId) {
          useVoiceStore.getState().setStatus("no active terminal session");
          clearVoiceStatusAfter();
          return;
        }
        const active = state.sessions.find((s) => s.id === state.activeSessionId);
        if (!active?.sessionId) {
          useVoiceStore.getState().setStatus("terminal session not ready", state.activeSessionId);
          clearVoiceStatusAfter();
          return;
        }

        if (voiceStatusTimerRef.current) {
          clearTimeout(voiceStatusTimerRef.current);
          voiceStatusTimerRef.current = null;
        }
        invalidatePendingPreviewWrites();
        voiceTargetTabIdRef.current = active.id;
        voiceTargetSessionIdRef.current = active.sessionId;
        voiceTargetSessionTypeRef.current = active.sessionType;
        stopBySubmitRef.current = false;
        stopEditingAfterStopRef.current = false;
        useVoiceStore.getState().setStatus("starting microphone...", active.id);
        voiceInputController.setDeviceId(voiceMicDeviceId);
        voiceInputController.start().catch(() => {
          useVoiceStore.getState().setError("unable to start voice capture", active.id);
          clearVoiceStatusAfter();
        });
        return;
      }

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

      // Ctrl+R — regenerate title for current Codex tab
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "r") {
        e.preventDefault();
        if (!activeSessionId) return;
        const active = sessions.find((s) => s.id === activeSessionId);
        if (!active || active.sessionType !== "codex") return;
        regenerateCodexTitle(active.projectPath, active.createdAt)
          .then((title) => {
            if (!title) return;
            setSessionTitle(active.id, title);
          })
          .catch(() => {});
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
    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
    };
  }, [sessions, activeSessionId, activeProjectPath, setActiveSession, setActiveProject, setSessionTitle, projects, voiceMicDeviceId]);
}
