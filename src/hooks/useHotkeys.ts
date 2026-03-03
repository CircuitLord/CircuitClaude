import { useEffect, useRef } from "react";
import { useSessionStore } from "../stores/sessionStore";
import { useProjectStore } from "../stores/projectStore";
import { useNotesStore } from "../stores/notesStore";
import { spawnNewSession } from "../lib/sessions";
import { closePtySession } from "../lib/pty";
import { regenerateCodexTitle } from "../lib/codexTitles";
import { voiceInputController, type VoiceInputState } from "../lib/voiceInput";
import { whisperDownloadModel, whisperGetModelStatus, type DownloadProgress } from "../lib/whisper";
import { useVoiceStore } from "../stores/voiceStore";
import { useSettingsStore } from "../stores/settingsStore";
import { Channel } from "@tauri-apps/api/core";

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
  const voiceEngine = useSettingsStore((s) => s.settings.voiceEngine);
  const voiceMicDeviceId = useSettingsStore((s) => s.settings.voiceMicDeviceId);
  const whisperModel = useSettingsStore((s) => s.settings.whisperModel);
  const voiceTargetTabIdRef = useRef<string | null>(null);
  const voiceTargetSessionIdRef = useRef<string | null>(null);
  const voiceStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceTranscriptBaseRef = useRef("");

  function clearVoiceStatusAfter(delayMs = 1800) {
    if (voiceStatusTimerRef.current) {
      clearTimeout(voiceStatusTimerRef.current);
    }
    voiceStatusTimerRef.current = setTimeout(() => {
      const vs = useVoiceStore.getState();
      if (vs.transcriptText.trim()) {
        // Don't auto-dismiss if there's text to review — just clear the status message
        vs.clearStatus();
      } else {
        vs.setIdle();
      }
      voiceStatusTimerRef.current = null;
    }, delayMs);
  }

  async function autoDownloadAndRetry(tabId: string, sessionId: string) {
    const model = useSettingsStore.getState().settings.whisperModel;

    // Check if already downloaded
    try {
      const status = await whisperGetModelStatus(model);
      if (status.downloaded) {
        // Model exists but failed to load for another reason
        useVoiceStore.getState().setError("failed to load whisper model", tabId);
        clearVoiceStatusAfter();
        return;
      }
    } catch {
      // Proceed with download attempt
    }

    useVoiceStore.getState().setStatus(`downloading ${model} model...`, tabId);

    const progressChannel = new Channel<DownloadProgress>();
    progressChannel.onmessage = (event: DownloadProgress) => {
      if (event.type === "Progress") {
        useVoiceStore.getState().setStatus(
          `downloading ${model} (${Math.round(event.data.percent)}%)...`,
          tabId,
        );
      }
    };

    try {
      await whisperDownloadModel(model, progressChannel);
      useVoiceStore.getState().setStatus("model downloaded, starting...", tabId);

      // Retry voice start
      voiceTargetTabIdRef.current = tabId;
      voiceTargetSessionIdRef.current = sessionId;
      voiceInputController.setModelName(model);
      const ok = await voiceInputController.start();
      if (!ok) {
        useVoiceStore.getState().setError("failed to start after download", tabId);
        clearVoiceStatusAfter();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      useVoiceStore.getState().setError(`download failed: ${message}`, tabId);
      clearVoiceStatusAfter();
    }
  }

  useEffect(() => {
    voiceInputController.configureHandlers({
      onStateChange: (state: VoiceInputState) => {
        // Don't re-populate the store if already dismissed (Escape/Enter)
        if (!useVoiceStore.getState().targetTabId && state !== "listening" && state !== "loading") return;
        const targetTabId = voiceTargetTabIdRef.current;
        const targetSessionId = voiceTargetSessionIdRef.current;
        if (state === "loading" && targetTabId) {
          useVoiceStore.getState().setStatus("loading model...", targetTabId);
          return;
        }
        if (state === "listening" && targetTabId && targetSessionId) {
          // Capture existing text as the base so new speech appends after it
          voiceTranscriptBaseRef.current = useVoiceStore.getState().transcriptText;
          useVoiceStore.getState().setListening(targetTabId, targetSessionId);
          return;
        }
        if (state === "processing") {
          useVoiceStore.getState().setProcessing(targetTabId);
        }
      },
      onInterimTranscript: (transcript: string) => {
        if (!useVoiceStore.getState().targetTabId) return;
        const normalized = transcript.trim();
        if (!normalized) return;
        const base = voiceTranscriptBaseRef.current;
        useVoiceStore.getState().setTranscriptText(
          base ? base + " " + normalized : normalized
        );
      },
      onFinalTranscript: (transcript: string) => {
        // Save the pre-listening base before clearing refs
        const savedBase = voiceTranscriptBaseRef.current;
        voiceTargetTabIdRef.current = null;
        voiceTargetSessionIdRef.current = null;
        voiceTranscriptBaseRef.current = "";

        // If the box was already dismissed (Escape/Enter), don't re-populate
        const storeTabId = useVoiceStore.getState().targetTabId;
        if (!storeTabId) return;

        const normalized = transcript.trim();
        if (normalized) {
          // Replace (not append) — interim handler already set base+interim,
          // so use the original base + finalized transcript to avoid duplication
          useVoiceStore.getState().setTranscriptText(
            savedBase ? savedBase + " " + normalized : normalized
          );
        }
        if (!normalized) {
          useVoiceStore.getState().setIdle();
        }
      },
      onError: (message: string) => {
        const targetTabId = voiceTargetTabIdRef.current;
        voiceTargetTabIdRef.current = null;
        voiceTargetSessionIdRef.current = null;
        useVoiceStore.getState().setError(message, targetTabId);
        clearVoiceStatusAfter();
      },
      onInfo: (message: string) => {
        useVoiceStore.getState().setStatus(message, useVoiceStore.getState().targetTabId);
      },
    });

    return () => {
      voiceInputController.configureHandlers({});
      if (voiceStatusTimerRef.current) {
        clearTimeout(voiceStatusTimerRef.current);
        voiceStatusTimerRef.current = null;
      }
      useVoiceStore.getState().setIdle();
    };
  }, []);

  useEffect(() => {
    voiceInputController.setEngine(voiceEngine);
  }, [voiceEngine]);

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

      // Ctrl+Space — toggle voice-to-text capture for active terminal session
      if (isCtrlSpaceHotkey(e)) {
        e.preventDefault();

        if (voiceInputController.isListening()) {
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
        voiceTargetTabIdRef.current = active.id;
        voiceTargetSessionIdRef.current = active.sessionId;
        useVoiceStore.getState().setStatus("starting microphone...", active.id);
        voiceInputController.setDeviceId(voiceMicDeviceId);
        if (voiceEngine === "whisper") {
          voiceInputController.setModelName(whisperModel);
        }

        const capturedSessionId = active.sessionId;
        voiceInputController.start().then((ok) => {
          if (!ok && voiceEngine === "whisper" && capturedSessionId) {
            // Check if it's a model-not-found error — trigger auto-download
            const lastErr = useVoiceStore.getState().lastError;
            if (lastErr && (lastErr.includes("Model not found") || lastErr.includes("not found"))) {
              void autoDownloadAndRetry(active.id, capturedSessionId);
            }
          }
        }).catch(() => {
          useVoiceStore.getState().setError("unable to start voice capture", active.id);
          clearVoiceStatusAfter();
        });
        return;
      }

      // Skip if focus is in an input/textarea (but not xterm's internal textarea or voice transcript box)
      const target = e.target as HTMLElement;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "SELECT") return;
      if (tag === "TEXTAREA" && !target.closest(".xterm") && !target.closest(".conversation-input-area") && !target.closest(".voice-transcript-box")) return;
      if (target.closest(".prompt-input")) return;

      // Ctrl+T — new session
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key === "t") {
        e.preventDefault();
        spawnNewSession();
        return;
      }

      // Ctrl+W — close active tab
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key === "w") {
        e.preventDefault();
        const state = useSessionStore.getState();
        if (!state.activeSessionId) return;
        const active = state.sessions.find((s) => s.id === state.activeSessionId);
        if (active?.sessionId) {
          closePtySession(active.sessionId).catch(() => {});
        }
        state.removeSession(state.activeSessionId);
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

      // Ctrl+1-9 — switch tab by index (within focused pane if split)
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key >= "1" && e.key <= "9") {
        e.preventDefault();
        if (!activeProjectPath) return;
        const state = useSessionStore.getState();
        const split = state.projectSplits.get(activeProjectPath);
        let tabIds: string[];
        if (split) {
          const pane = split.focusedPane === 1 ? split.pane1 : split.pane2;
          tabIds = pane.sessionIds;
        } else {
          tabIds = sessions.filter((s) => s.projectPath === activeProjectPath).map((s) => s.id);
        }
        const index = parseInt(e.key, 10) - 1;
        if (index < tabIds.length) {
          setActiveSession(tabIds[index]);
        }
        return;
      }

      // Ctrl+Left/Right — cycle tabs within focused pane (or all project tabs if unsplit)
      if (e.ctrlKey && !e.shiftKey && !e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        e.preventDefault();
        if (!activeProjectPath) return;
        const state = useSessionStore.getState();
        const split = state.projectSplits.get(activeProjectPath);
        let tabIds: string[];
        if (split) {
          const pane = split.focusedPane === 1 ? split.pane1 : split.pane2;
          tabIds = pane.sessionIds;
        } else {
          tabIds = sessions.filter((s) => s.projectPath === activeProjectPath).map((s) => s.id);
        }
        if (tabIds.length <= 1) return;
        const currentIndex = tabIds.indexOf(activeSessionId ?? "");
        const delta = e.key === "ArrowRight" ? 1 : -1;
        const nextIndex = (currentIndex + delta + tabIds.length) % tabIds.length;
        setActiveSession(tabIds[nextIndex]);
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
  }, [sessions, activeSessionId, activeProjectPath, setActiveSession, setActiveProject, setSessionTitle, projects, voiceEngine, voiceMicDeviceId, whisperModel]);
}
