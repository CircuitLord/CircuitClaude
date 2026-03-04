use notify_debouncer_mini::notify;
use notify_debouncer_mini::{new_debouncer, DebouncedEventKind};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::Emitter;

struct WatchEntry {
    tab_ids: Vec<String>,
    _debouncer: notify_debouncer_mini::Debouncer<notify::RecommendedWatcher>,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct FileChangedPayload {
    file_path: String,
}

pub struct FileWatcherManager {
    app: tauri::AppHandle,
    watches: Arc<Mutex<HashMap<String, WatchEntry>>>,
}

impl FileWatcherManager {
    pub fn new(app: tauri::AppHandle) -> Self {
        Self {
            app,
            watches: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Normalize path for use as a map key (forward slashes, lowercase on Windows).
    fn normalize(path: &str) -> String {
        let p = path.replace('\\', "/");
        #[cfg(windows)]
        {
            p.to_lowercase()
        }
        #[cfg(not(windows))]
        {
            p
        }
    }

    pub fn watch_file(&self, tab_id: &str, file_path: &str) -> Result<(), String> {
        let key = Self::normalize(file_path);
        let mut watches = self.watches.lock().map_err(|e| e.to_string())?;

        // If already watched, just add the tab ID
        if let Some(entry) = watches.get_mut(&key) {
            if !entry.tab_ids.contains(&tab_id.to_string()) {
                entry.tab_ids.push(tab_id.to_string());
            }
            return Ok(());
        }

        // Watch the parent directory (more reliable on Windows than watching a single file)
        let target = PathBuf::from(file_path);
        let parent = target
            .parent()
            .ok_or_else(|| "Cannot determine parent directory".to_string())?;
        let target_canon = target
            .canonicalize()
            .unwrap_or_else(|_| target.clone());

        let app_handle = self.app.clone();
        let watched_path = file_path.to_string();

        let mut debouncer = new_debouncer(
            Duration::from_millis(500),
            move |results: Result<Vec<notify_debouncer_mini::DebouncedEvent>, notify::Error>| {
                let events = match results {
                    Ok(evts) => evts,
                    Err(_) => return,
                };

                for event in &events {
                    if event.kind != DebouncedEventKind::Any {
                        continue;
                    }

                    // Check if the changed file matches our target
                    let changed = event
                        .path
                        .canonicalize()
                        .unwrap_or_else(|_| event.path.clone());

                    if changed == target_canon {
                        let _ = app_handle.emit(
                            "file-changed",
                            FileChangedPayload {
                                file_path: watched_path.clone(),
                            },
                        );
                        break;
                    }
                }
            },
        )
        .map_err(|e| format!("Failed to create file watcher: {}", e))?;

        debouncer
            .watcher()
            .watch(parent, notify::RecursiveMode::NonRecursive)
            .map_err(|e| format!("Failed to watch directory: {}", e))?;

        watches.insert(
            key,
            WatchEntry {
                tab_ids: vec![tab_id.to_string()],
                _debouncer: debouncer,
            },
        );

        Ok(())
    }

    pub fn unwatch_file(&self, tab_id: &str, file_path: &str) -> Result<(), String> {
        let key = Self::normalize(file_path);
        let mut watches = self.watches.lock().map_err(|e| e.to_string())?;

        if let Some(entry) = watches.get_mut(&key) {
            entry.tab_ids.retain(|id| id != tab_id);
            if entry.tab_ids.is_empty() {
                watches.remove(&key);
            }
        }

        Ok(())
    }

    pub fn cleanup(&self) {
        if let Ok(mut watches) = self.watches.lock() {
            watches.clear();
        }
    }
}

// Required for Tauri's State<> to work across threads
unsafe impl Send for FileWatcherManager {}
unsafe impl Sync for FileWatcherManager {}
