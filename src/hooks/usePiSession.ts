import { useCallback, useEffect, useRef, useState } from "react";
import { Channel } from "@tauri-apps/api/core";
import { abortPiSession, createPiSession, destroyPiSession, sendPiCommand, sendPiMessage } from "../lib/pi";
import { getPiResponseError, getPiTabStatusForEvent, isPiRpcResponse, type PiRpcCommand, type PiRpcEvent } from "../lib/piRpc";
import { usePiChatStore } from "../stores/piChatStore";
import { useSessionStore } from "../stores/sessionStore";

interface UsePiSessionOptions {
  tabId: string;
  projectPath: string;
  title?: string;
}

interface UsePiSessionResult {
  ready: boolean;
  backendId: string | null;
  sendMessage: (message: string) => Promise<void>;
  sendCommand: <T = unknown>(command: PiRpcCommand) => Promise<T>;
  interrupt: () => Promise<void>;
}

interface PendingCommand {
  resolve: (data: unknown) => void;
  reject: (error: Error) => void;
}

export function usePiSession({ tabId, projectPath, title = "pi chat" }: UsePiSessionOptions): UsePiSessionResult {
  const backendIdRef = useRef<string | null>(null);
  const pendingCommandsRef = useRef(new Map<string, PendingCommand>());
  const statusClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [ready, setReady] = useState(false);
  const [backendId, setBackendId] = useState<string | null>(null);

  const appendEvent = usePiChatStore((state) => state.appendEvent);
  const appendError = usePiChatStore((state) => state.appendError);
  const removeChat = usePiChatStore((state) => state.removeChat);
  const setTabStatus = useSessionStore((state) => state.setTabStatus);
  const setSessionTitle = useSessionStore((state) => state.setSessionTitle);
  const updateSessionPtyId = useSessionStore((state) => state.updateSessionPtyId);

  useEffect(() => {
    let cleanedUp = false;
    setReady(false);
    setBackendId(null);
    setSessionTitle(tabId, title);

    const channel = new Channel<PiRpcEvent>();
    channel.onmessage = (event) => {
      if (cleanedUp) return;

      if (isPiRpcResponse(event) && typeof event.id === "string") {
        const pending = pendingCommandsRef.current.get(event.id);
        if (pending) {
          pendingCommandsRef.current.delete(event.id);
          if (event.success) {
            pending.resolve(event.data);
          } else {
            pending.reject(new Error(getPiResponseError(event)));
          }
        }
      }

      appendEvent(tabId, event);
      const status = getPiTabStatusForEvent(event);
      if (status !== undefined) {
        if (statusClearTimerRef.current) {
          clearTimeout(statusClearTimerRef.current);
          statusClearTimerRef.current = null;
        }
        if (status === null) {
          statusClearTimerRef.current = setTimeout(() => {
            statusClearTimerRef.current = null;
            setTabStatus(tabId, null);
          }, 450);
        } else {
          setTabStatus(tabId, status);
        }
      }
    };

    createPiSession(projectPath, channel)
      .then((backendId) => {
        if (cleanedUp) {
          destroyPiSession(backendId).catch(() => {});
          return;
        }
        backendIdRef.current = backendId;
        setBackendId(backendId);
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
      if (statusClearTimerRef.current) {
        clearTimeout(statusClearTimerRef.current);
        statusClearTimerRef.current = null;
      }
      const backendId = backendIdRef.current;
      backendIdRef.current = null;
      setBackendId(null);
      for (const pending of pendingCommandsRef.current.values()) {
        pending.reject(new Error("pi session closed"));
      }
      pendingCommandsRef.current.clear();
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

  const sendCommand = useCallback(async <T = unknown,>(command: PiRpcCommand): Promise<T> => {
    const backendId = backendIdRef.current;
    if (!backendId) throw new Error("pi session is not ready");

    const id = crypto.randomUUID();
    const response = new Promise<T>((resolve, reject) => {
      pendingCommandsRef.current.set(id, {
        resolve: (data) => resolve(data as T),
        reject,
      });
    });

    try {
      await sendPiCommand(backendId, { ...command, id });
    } catch (err) {
      pendingCommandsRef.current.delete(id);
      throw err;
    }

    return response;
  }, []);

  const interrupt = useCallback(async () => {
    const backendId = backendIdRef.current;
    if (!backendId) return;
    await abortPiSession(backendId);
  }, []);

  return { ready, backendId, sendMessage, sendCommand, interrupt };
}
