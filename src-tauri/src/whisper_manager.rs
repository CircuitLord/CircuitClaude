use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;

const INFERENCE_THRESHOLD_SAMPLES: usize = 24_000; // 1.5s at 16kHz
const MAX_BUFFER_SAMPLES: usize = 480_000; // 30s at 16kHz
const COMMIT_THRESHOLD_SAMPLES: usize = 384_000; // 24s — commit early audio beyond this

/// How many hardware threads to give whisper.cpp for inference.
/// Using all physical cores starves the UI; cap at a sensible default.
fn inference_threads() -> i32 {
    let cpus = std::thread::available_parallelism()
        .map(|n| n.get() as i32)
        .unwrap_or(4);
    // Use half the cores, minimum 2, maximum 8
    (cpus / 2).clamp(2, 8)
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", content = "data")]
#[allow(dead_code)]
pub enum WhisperEvent {
    Transcript {
        text: String,
        is_final: bool,
    },
    Ready,
    Error {
        message: String,
    },
    ModelStatus {
        model: String,
        downloaded: bool,
        size_bytes: Option<u64>,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", content = "data")]
pub enum DownloadProgress {
    Started { model: String },
    Progress { model: String, percent: f64 },
    Complete { model: String },
    Error { model: String, message: String },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub name: String,
    pub downloaded: bool,
    pub size_bytes: Option<u64>,
}

struct WhisperSession {
    buffer: Vec<f32>,
    committed_text: String,
    /// The most recent full transcript from background inference (committed + inferred).
    last_transcript: String,
    /// Snapshot of buffer.len() at the time `last_transcript` was produced.
    last_transcript_at_samples: usize,
    channel: Channel<WhisperEvent>,
    inference_in_flight: Arc<AtomicBool>,
}

/// All fields are Arc-wrapped, so Clone is cheap and just bumps refcounts.
#[derive(Clone)]
pub struct WhisperManager {
    sessions: Arc<Mutex<HashMap<String, WhisperSession>>>,
    context: Arc<Mutex<Option<whisper_rs::WhisperContext>>>,
    loaded_model: Arc<Mutex<Option<String>>>,
    models_dir: PathBuf,
}

impl WhisperManager {
    pub fn new(models_dir: PathBuf) -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            context: Arc::new(Mutex::new(None)),
            loaded_model: Arc::new(Mutex::new(None)),
            models_dir,
        }
    }

    fn model_path(&self, name: &str) -> PathBuf {
        self.models_dir.join(format!("ggml-{}.bin", name))
    }

    pub fn load_model(&self, name: &str) -> Result<(), String> {
        // Check if already loaded
        {
            let loaded = self.loaded_model.lock().unwrap();
            if loaded.as_deref() == Some(name) {
                return Ok(());
            }
        }

        let path = self.model_path(name);
        if !path.exists() {
            return Err(format!(
                "Model not found: {}. Download it first.",
                path.display()
            ));
        }

        let mut ctx_params = whisper_rs::WhisperContextParameters::default();
        ctx_params.flash_attn(true);

        let ctx = whisper_rs::WhisperContext::new_with_params(
            path.to_str().ok_or("Invalid model path")?,
            ctx_params,
        )
        .map_err(|e| format!("Failed to load whisper model: {}", e))?;

        let mut context = self.context.lock().unwrap();
        *context = Some(ctx);
        let mut loaded = self.loaded_model.lock().unwrap();
        *loaded = Some(name.to_string());

        Ok(())
    }

    pub fn start_session(
        &self,
        session_id: &str,
        model_name: &str,
        channel: Channel<WhisperEvent>,
    ) -> Result<(), String> {
        self.load_model(model_name)?;

        let session = WhisperSession {
            buffer: Vec::new(),
            committed_text: String::new(),
            last_transcript: String::new(),
            last_transcript_at_samples: 0,
            channel: channel.clone(),
            inference_in_flight: Arc::new(AtomicBool::new(false)),
        };

        self.sessions
            .lock()
            .unwrap()
            .insert(session_id.to_string(), session);

        let _ = channel.send(WhisperEvent::Ready);
        Ok(())
    }

    pub fn push_audio(&self, session_id: &str, samples: Vec<f32>) -> Result<(), String> {
        let (inference_in_flight, channel) = {
            let sessions = self.sessions.lock().unwrap();
            let session = sessions
                .get(session_id)
                .ok_or_else(|| format!("Whisper session not found: {}", session_id))?;
            (session.inference_in_flight.clone(), session.channel.clone())
        };

        // Append samples to buffer
        {
            let mut sessions = self.sessions.lock().unwrap();
            let session = sessions.get_mut(session_id).ok_or("Session gone")?;
            session.buffer.extend_from_slice(&samples);

            // Cap buffer at max — commit earlier audio as text
            if session.buffer.len() > MAX_BUFFER_SAMPLES {
                let keep_from = session.buffer.len() - COMMIT_THRESHOLD_SAMPLES;
                session.buffer.drain(..keep_from);
            }
        }

        // Check if we should trigger inference
        let should_infer = {
            let sessions = self.sessions.lock().unwrap();
            let session = sessions.get(session_id).ok_or("Session gone")?;
            session.buffer.len() >= INFERENCE_THRESHOLD_SAMPLES
                && !inference_in_flight.load(Ordering::Relaxed)
        };

        if should_infer {
            self.trigger_inference(session_id, &inference_in_flight, &channel)?;
        }

        Ok(())
    }

    pub fn stop_session(&self, session_id: &str) -> Result<String, String> {
        // Extract what we need and remove the session atomically
        let (buffer, committed_text, last_transcript, last_transcript_at_samples, channel, inference_flag) = {
            let sessions = self.sessions.lock().unwrap();
            let session = sessions
                .get(session_id)
                .ok_or_else(|| format!("Whisper session not found: {}", session_id))?;
            (
                session.buffer.clone(),
                session.committed_text.clone(),
                session.last_transcript.clone(),
                session.last_transcript_at_samples,
                session.channel.clone(),
                session.inference_in_flight.clone(),
            )
        };

        // Wait for any in-flight inference to complete (spin briefly)
        // This avoids locking the context while a background thread holds it.
        for _ in 0..500 {
            if !inference_flag.load(Ordering::Relaxed) {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }

        // Re-read the session in case inference updated last_transcript while we waited
        let (latest_transcript, latest_at_samples) = {
            let sessions = self.sessions.lock().unwrap();
            match sessions.get(session_id) {
                Some(s) => (s.last_transcript.clone(), s.last_transcript_at_samples),
                None => (last_transcript.clone(), last_transcript_at_samples),
            }
        };

        let final_text = if buffer.is_empty() {
            committed_text.clone()
        } else if buffer.len().saturating_sub(latest_at_samples) < INFERENCE_THRESHOLD_SAMPLES
            && !latest_transcript.is_empty()
        {
            // Less than 1.5s of new audio since last inference — reuse that transcript
            // rather than blocking for another full pass.
            latest_transcript
        } else {
            // Significant new audio since last inference — run final pass
            let ctx_guard = self.context.lock().unwrap();
            let ctx = ctx_guard.as_ref().ok_or("No whisper model loaded")?;
            let inferred = run_inference(ctx, &buffer)?;
            merge_text(&committed_text, &inferred)
        };

        let _ = channel.send(WhisperEvent::Transcript {
            text: final_text.clone(),
            is_final: true,
        });

        // Remove session
        self.sessions.lock().unwrap().remove(session_id);

        Ok(final_text)
    }

    pub fn cancel_session(&self, session_id: &str) {
        self.sessions.lock().unwrap().remove(session_id);
    }

    pub fn cancel_all(&self) {
        self.sessions.lock().unwrap().clear();
    }

    pub fn download_model(
        &self,
        name: &str,
        progress_channel: Channel<DownloadProgress>,
    ) -> Result<(), String> {
        let url = format!(
            "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-{}.bin",
            name
        );
        let dest = self.model_path(name);
        let partial = dest.with_extension("bin.partial");

        std::fs::create_dir_all(&self.models_dir)
            .map_err(|e| format!("Failed to create models dir: {}", e))?;

        let _ = progress_channel.send(DownloadProgress::Started {
            model: name.to_string(),
        });

        let client = reqwest::blocking::Client::new();
        let response = client
            .get(&url)
            .send()
            .map_err(|e| format!("Download request failed: {}", e))?;

        if !response.status().is_success() {
            let msg = format!("Download failed with status: {}", response.status());
            let _ = progress_channel.send(DownloadProgress::Error {
                model: name.to_string(),
                message: msg.clone(),
            });
            return Err(msg);
        }

        let total_size = response.content_length().unwrap_or(0);
        let mut downloaded: u64 = 0;
        let mut last_percent: i32 = -1;

        let mut file = std::fs::File::create(&partial)
            .map_err(|e| format!("Failed to create partial file: {}", e))?;

        use std::io::{Read, Write};
        let mut reader = response;
        let mut buf = [0u8; 65536];

        loop {
            let n = reader
                .read(&mut buf)
                .map_err(|e| format!("Download read error: {}", e))?;
            if n == 0 {
                break;
            }
            file.write_all(&buf[..n])
                .map_err(|e| format!("Write error: {}", e))?;
            downloaded += n as u64;

            if total_size > 0 {
                let percent = ((downloaded as f64 / total_size as f64) * 100.0) as i32;
                if percent != last_percent {
                    last_percent = percent;
                    let _ = progress_channel.send(DownloadProgress::Progress {
                        model: name.to_string(),
                        percent: percent as f64,
                    });
                }
            }
        }

        drop(file);

        // Rename partial to final
        std::fs::rename(&partial, &dest)
            .map_err(|e| format!("Failed to finalize download: {}", e))?;

        let _ = progress_channel.send(DownloadProgress::Complete {
            model: name.to_string(),
        });

        Ok(())
    }

    pub fn get_available_models(&self) -> Vec<ModelInfo> {
        let known = ["tiny.en", "base.en", "small.en", "medium.en"];
        known
            .iter()
            .map(|name| {
                let path = self.model_path(name);
                let (downloaded, size) = if path.exists() {
                    let size = std::fs::metadata(&path).ok().map(|m| m.len());
                    (true, size)
                } else {
                    (false, None)
                };
                ModelInfo {
                    name: name.to_string(),
                    downloaded,
                    size_bytes: size,
                }
            })
            .collect()
    }

    pub fn get_model_status(&self, name: &str) -> ModelInfo {
        let path = self.model_path(name);
        let (downloaded, size) = if path.exists() {
            let size = std::fs::metadata(&path).ok().map(|m| m.len());
            (true, size)
        } else {
            (false, None)
        };
        ModelInfo {
            name: name.to_string(),
            downloaded,
            size_bytes: size,
        }
    }

    fn trigger_inference(
        &self,
        session_id: &str,
        inference_flag: &Arc<AtomicBool>,
        channel: &Channel<WhisperEvent>,
    ) -> Result<(), String> {
        inference_flag.store(true, Ordering::Relaxed);

        let (buffer, committed_text) = {
            let sessions = self.sessions.lock().unwrap();
            let session = sessions.get(session_id).ok_or("Session gone")?;
            (session.buffer.clone(), session.committed_text.clone())
        };

        let buffer_len = buffer.len();
        let ctx_arc = self.context.clone();
        let channel = channel.clone();
        let sessions_arc = self.sessions.clone();
        let session_id = session_id.to_string();
        let inference_flag = inference_flag.clone();

        std::thread::spawn(move || {
            let result = {
                let ctx_guard = ctx_arc.lock().unwrap();
                match ctx_guard.as_ref() {
                    Some(ctx) => run_inference(ctx, &buffer),
                    None => Err("No model loaded".to_string()),
                }
            };

            inference_flag.store(false, Ordering::Relaxed);

            match result {
                Ok(text) => {
                    let full = merge_text(&committed_text, &text);

                    {
                        let mut sessions = sessions_arc.lock().unwrap();
                        if let Some(session) = sessions.get_mut(&session_id) {
                            // Always store the latest transcript for stop_session to reuse
                            session.last_transcript = full.clone();
                            session.last_transcript_at_samples = buffer_len;

                            // Commit text if buffer has grown beyond threshold
                            if session.buffer.len() > COMMIT_THRESHOLD_SAMPLES {
                                session.committed_text = full.clone();
                            }
                        }
                    }

                    let _ = channel.send(WhisperEvent::Transcript {
                        text: full,
                        is_final: false,
                    });
                }
                Err(msg) => {
                    let _ = channel.send(WhisperEvent::Error { message: msg });
                }
            }
        });

        Ok(())
    }
}

fn run_inference(ctx: &whisper_rs::WhisperContext, samples: &[f32]) -> Result<String, String> {
    let mut state = ctx
        .create_state()
        .map_err(|e| format!("Failed to create whisper state: {}", e))?;

    let mut params = whisper_rs::FullParams::new(whisper_rs::SamplingStrategy::Greedy { best_of: 1 });
    params.set_n_threads(inference_threads());
    params.set_language(Some("en"));
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);
    params.set_print_special(false);
    params.set_no_context(true);
    params.set_single_segment(false);
    params.set_suppress_blank(true);
    params.set_suppress_nst(true);

    state
        .full(params, samples)
        .map_err(|e| format!("Whisper inference failed: {}", e))?;

    let num_segments = state.full_n_segments();
    let mut text = String::new();
    for i in 0..num_segments {
        if let Some(segment) = state.get_segment(i) {
            if let Ok(seg_text) = segment.to_str_lossy() {
                text.push_str(&seg_text);
            }
        }
    }

    Ok(text.trim().to_string())
}

fn merge_text(committed: &str, new_text: &str) -> String {
    if committed.is_empty() {
        return new_text.to_string();
    }
    if new_text.is_empty() {
        return committed.to_string();
    }
    format!("{} {}", committed.trim(), new_text.trim())
}
