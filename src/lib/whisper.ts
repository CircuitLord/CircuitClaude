import { invoke, Channel } from "@tauri-apps/api/core";

export type WhisperEvent =
  | { type: "Transcript"; data: { text: string; is_final: boolean } }
  | { type: "Ready"; data: null }
  | { type: "Error"; data: { message: string } }
  | { type: "ModelStatus"; data: { model: string; downloaded: boolean; size_bytes: number | null } };

export type DownloadProgress =
  | { type: "Started"; data: { model: string } }
  | { type: "Progress"; data: { model: string; percent: number } }
  | { type: "Complete"; data: { model: string } }
  | { type: "Error"; data: { model: string; message: string } };

export interface ModelInfo {
  name: string;
  downloaded: boolean;
  sizeBytes: number | null;
}

export function whisperStartSession(
  sessionId: string,
  modelName: string,
  onEvent: Channel<WhisperEvent>,
): Promise<void> {
  return invoke("whisper_start_session", { sessionId, modelName, onEvent });
}

export function whisperPushAudio(sessionId: string, samples: number[]): Promise<void> {
  return invoke("whisper_push_audio", { sessionId, samples });
}

export function whisperStopSession(sessionId: string): Promise<string> {
  return invoke<string>("whisper_stop_session", { sessionId });
}

export function whisperCancelSession(sessionId: string): Promise<void> {
  return invoke("whisper_cancel_session", { sessionId });
}

export function whisperLoadModel(modelName: string): Promise<void> {
  return invoke("whisper_load_model", { modelName });
}

export function whisperGetAvailableModels(): Promise<ModelInfo[]> {
  return invoke<ModelInfo[]>("whisper_get_available_models");
}

export function whisperDownloadModel(
  modelName: string,
  onProgress: Channel<DownloadProgress>,
): Promise<void> {
  return invoke("whisper_download_model", { modelName, onProgress });
}

export function whisperGetModelStatus(modelName: string): Promise<ModelInfo> {
  return invoke<ModelInfo>("whisper_get_model_status", { modelName });
}
