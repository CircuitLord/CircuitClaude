import { create } from "zustand";

interface VoiceStore {
  isListening: boolean;
  statusMessage: string | null;
  targetTabId: string | null;
  targetSessionId: string | null;
  transcriptText: string;
  lastError: string | null;
  setListening: (tabId: string, sessionId: string, message?: string) => void;
  setProcessing: (tabId?: string | null, message?: string | null) => void;
  setIdle: () => void;
  setError: (message: string, tabId?: string | null) => void;
  setStatus: (message: string, tabId?: string | null) => void;
  setTranscriptText: (text: string) => void;
  clearStatus: () => void;
}

export const useVoiceStore = create<VoiceStore>((set) => ({
  isListening: false,
  statusMessage: null,
  targetTabId: null,
  targetSessionId: null,
  transcriptText: "",
  lastError: null,

  setListening: (tabId, sessionId, message = "listening...") =>
    set({
      isListening: true,
      statusMessage: message,
      targetTabId: tabId,
      targetSessionId: sessionId,
      lastError: null,
    }),

  setProcessing: (tabId, message = null) =>
    set((state) => ({
      isListening: false,
      statusMessage: message,
      targetTabId: tabId ?? state.targetTabId,
      lastError: null,
    })),

  setIdle: () =>
    set({
      isListening: false,
      statusMessage: null,
      targetTabId: null,
      targetSessionId: null,
      transcriptText: "",
    }),

  setError: (message, tabId) =>
    set((state) => ({
      isListening: false,
      statusMessage: message,
      targetTabId: tabId ?? state.targetTabId,
      targetSessionId: null,
      transcriptText: "",
      lastError: message,
    })),

  setStatus: (message, tabId) =>
    set((state) => ({
      statusMessage: message,
      targetTabId: tabId ?? state.targetTabId,
    })),

  setTranscriptText: (text) =>
    set({ transcriptText: text }),

  clearStatus: () =>
    set((state) => {
      const keepAlive = state.isListening || !!state.transcriptText.trim();
      return {
        statusMessage: state.isListening ? "listening..." : null,
        targetTabId: keepAlive ? state.targetTabId : null,
      };
    }),
}));
