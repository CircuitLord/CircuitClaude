import { useState, useEffect, useCallback } from "react";
import {
  checkForUpdate,
  downloadAndInstallUpdate,
  type UpdateInfo,
} from "../lib/updater";

export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "error";

export function useUpdateCheck() {
  const [status, setStatus] = useState<UpdateStatus>("idle");
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async () => {
    setStatus("checking");
    setError(null);
    try {
      const info = await checkForUpdate();
      if (info) {
        setUpdateInfo(info);
        setStatus("available");
      } else {
        setStatus("idle");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }, []);

  const install = useCallback(async () => {
    setStatus("downloading");
    try {
      await downloadAndInstallUpdate();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }, []);

  const dismiss = useCallback(() => {
    setStatus("idle");
    setUpdateInfo(null);
  }, []);

  // Check on mount (app launch) with a small delay
  useEffect(() => {
    const timer = setTimeout(() => check(), 3000);
    return () => clearTimeout(timer);
  }, [check]);

  return { status, updateInfo, error, check, install, dismiss };
}
