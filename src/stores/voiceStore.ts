import { create } from "zustand";

interface VoiceStore {
  isListening: boolean;
  statusMessage: string | null;
  targetTabId: string | null;
  lastError: string | null;
  setListening: (tabId: string, message?: string) => void;
  setProcessing: (tabId?: string | null, message?: string) => void;
  setIdle: () => void;
  setError: (message: string, tabId?: string | null) => void;
  setStatus: (message: string, tabId?: string | null) => void;
  clearStatus: () => void;
}

export const useVoiceStore = create<VoiceStore>((set) => ({
  isListening: false,
  statusMessage: null,
  targetTabId: null,
  lastError: null,

  setListening: (tabId, message = "listening...") =>
    set({
      isListening: true,
      statusMessage: message,
      targetTabId: tabId,
      lastError: null,
    }),

  setProcessing: (tabId, message = "processing speech...") =>
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
    }),

  setError: (message, tabId) =>
    set((state) => ({
      isListening: false,
      statusMessage: message,
      targetTabId: tabId ?? state.targetTabId,
      lastError: message,
    })),

  setStatus: (message, tabId) =>
    set((state) => ({
      statusMessage: message,
      targetTabId: tabId ?? state.targetTabId,
    })),

  clearStatus: () =>
    set((state) => ({
      statusMessage: state.isListening ? "listening..." : null,
      targetTabId: state.isListening ? state.targetTabId : null,
    })),
}));
