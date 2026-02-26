import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export interface UpdateInfo {
  version: string;
  body: string | null;
}

export interface UpdateProgress {
  downloaded: number;
  total: number | null;
}

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  const update = await check();
  if (!update) return null;
  return { version: update.version, body: update.body ?? null };
}

export async function downloadAndInstallUpdate(
  onProgress?: (progress: UpdateProgress) => void,
): Promise<void> {
  const update = await check();
  if (!update) throw new Error("No update available");

  let totalDownloaded = 0;
  await update.downloadAndInstall((event) => {
    if (event.event === "Started" && onProgress) {
      onProgress({ downloaded: 0, total: event.data.contentLength ?? null });
    } else if (event.event === "Progress" && onProgress) {
      totalDownloaded += event.data.chunkLength;
      onProgress({ downloaded: totalDownloaded, total: null });
    }
  });

  await relaunch();
}
