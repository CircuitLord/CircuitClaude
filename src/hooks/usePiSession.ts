import { useCallback, useEffect, useRef, useState } from "react";
import { Channel } from "@tauri-apps/api/core";
import { abortPiSession, createPiSession, destroyPiSession, sendPiMessage } from "../lib/pi";
import { getPiTabStatusForEvent, type PiRpcEvent } from "../lib/piRpc";
import { usePiChatStore } from "../stores/piChatStore";
import { useSessionStore } from "../stores/sessionStore";

interface UsePiSessionOptions {
  tabId: string;
  projectPath: string;
  title?: string;
}

interface UsePiSessionResult {
  ready: boolean;
  sendMessage: (message: string) => Promise<void>;
  interrupt: () => Promise<void>;
}

export function usePiSession({ tabId, projectPath, title = "pi chat" }: UsePiSessionOptions): UsePiSessionResult {
  const backendIdRef = useRef<string | null>(null);
  const [ready, setReady] = useState(false);

  const appendEvent = usePiChatStore((state) => state.appendEvent);
  const appendError = usePiChatStore((state) => state.appendError);
  const removeChat = usePiChatStore((state) => state.removeChat);
  const setTabStatus = useSessionStore((state) => state.setTabStatus);
  const setSessionTitle = useSessionStore((state) => state.setSessionTitle);
  const updateSessionPtyId = useSessionStore((state) => state.updateSessionPtyId);

  useEffect(() => {
    let cleanedUp = false;
    setReady(false);
    setSessionTitle(tabId, title);

    const channel = new Channel<PiRpcEvent>();
    channel.onmessage = (event) => {
      if (cleanedUp) return;
      appendEvent(tabId, event);
      const status = getPiTabStatusForEvent(event);
      if (status !== undefined) {
        setTabStatus(tabId, status);
      }
    };

    createPiSession(projectPath, channel)
      .then((backendId) => {
        if (cleanedUp) {
          destroyPiSession(backendId).catch(() => {});
          return;
        }
        backendIdRef.current = backendId;
        updateSessionPtyId(tabId, backendId);
        setReady(true);
      })
      .catch((err) => {
        if (cleanedUp) return;
        appendError(tabId, `Failed to start pi: ${String(err)}`);
        setTabStatus(tabId, null);
      });

    return () => {
      cleanedUp = true;
      setReady(false);
      const backendId = backendIdRef.current;
      backendIdRef.current = null;
      if (backendId) {
        destroyPiSession(backendId).catch(() => {});
      }
      removeChat(tabId);
      setTabStatus(tabId, null);
    };
  }, [appendError, appendEvent, projectPath, removeChat, setSessionTitle, setTabStatus, tabId, title, updateSessionPtyId]);

  const sendMessage = useCallback(async (message: string) => {
    const backendId = backendIdRef.current;
    if (!backendId) throw new Error("pi session is not ready");
    await sendPiMessage(backendId, message);
  }, []);

  const interrupt = useCallback(async () => {
    const backendId = backendIdRef.current;
    if (!backendId) return;
    await abortPiSession(backendId);
  }, []);

  return { ready, sendMessage, interrupt };
}
