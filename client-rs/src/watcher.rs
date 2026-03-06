use crate::state::{AppEvent, EventSender, SharedState, WatcherStatus};
use crate::uploader;
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::sync::mpsc as tokio_mpsc;

/// Stabilization wait before uploading (same as chokidar's awaitWriteFinish)
const STABILITY_THRESHOLD: Duration = Duration::from_secs(5);
const POLL_INTERVAL: Duration = Duration::from_secs(1);

/// Handle to a running watcher that can be stopped
pub struct WatcherHandle {
    _watcher: RecommendedWatcher,
    stop_tx: tokio_mpsc::Sender<()>,
}

impl WatcherHandle {
    /// Stop the watcher and its stabilization task
    pub fn stop(self) {
        // Drop watcher (stops OS-level watching)
        // Signal the stabilization task to stop
        let _ = self.stop_tx.send(());
    }
}

/// Start watching a directory for new .StormReplay files.
/// Returns a handle that can be used to stop the watcher.
pub fn start_watcher(
    replay_dir: &str,
    state: SharedState,
    tx: EventSender,
    runtime: tokio::runtime::Handle,
) -> Result<WatcherHandle, String> {
    let dir = PathBuf::from(replay_dir);
    if !dir.is_dir() {
        return Err(format!("Not a directory: {}", replay_dir));
    }

    // Channel for raw filesystem events → stabilization task
    let (fs_tx, mut fs_rx) = tokio_mpsc::unbounded_channel::<PathBuf>();

    // Channel to stop the stabilization task
    let (stop_tx, mut stop_rx) = tokio_mpsc::channel::<()>(1);

    // Spawn the stabilization task: waits for file to be stable before uploading
    let state_clone = state.clone();
    let tx_clone = tx.clone();
    runtime.spawn(async move {
        // Track pending files and when they were last seen modified
        let pending: Arc<Mutex<HashMap<PathBuf, Instant>>> = Arc::new(Mutex::new(HashMap::new()));

        loop {
            tokio::select! {
                // Receive new file notification
                Some(path) = fs_rx.recv() => {
                    let mut p = pending.lock().unwrap();
                    p.insert(path, Instant::now());
                }
                // Poll for stable files
                _ = tokio::time::sleep(POLL_INTERVAL) => {
                    let mut ready = Vec::new();
                    {
                        let mut p = pending.lock().unwrap();
                        let now = Instant::now();
                        p.retain(|path, last_seen| {
                            if now.duration_since(*last_seen) >= STABILITY_THRESHOLD {
                                ready.push(path.clone());
                                false // remove from pending
                            } else {
                                true
                            }
                        });
                    }
                    for path in ready {
                        uploader::upload_file(&path, &state_clone, &tx_clone).await;
                    }
                }
                // Stop signal
                _ = stop_rx.recv() => {
                    break;
                }
            }
        }
    });

    // Create the OS-level file watcher
    let watcher_dir = dir.clone();
    let mut watcher = notify::recommended_watcher(move |result: Result<Event, notify::Error>| {
        if let Ok(event) = result {
            match event.kind {
                EventKind::Create(_) | EventKind::Modify(_) => {
                    for path in event.paths {
                        if is_storm_replay(&path) {
                            let _ = fs_tx.send(path);
                        }
                    }
                }
                _ => {}
            }
        }
    })
    .map_err(|e| format!("Failed to create watcher: {}", e))?;

    watcher
        .watch(&watcher_dir, RecursiveMode::NonRecursive)
        .map_err(|e| format!("Failed to watch directory: {}", e))?;

    // Update state
    {
        let mut s = state.lock().unwrap();
        s.watcher_status = WatcherStatus::Watching;
        s.replay_dir = Some(replay_dir.to_string());
        s.request_repaint();
    }
    let _ = tx.send(AppEvent::WatcherStarted);
    println!("Watching: {}", replay_dir);

    Ok(WatcherHandle {
        _watcher: watcher,
        stop_tx,
    })
}

fn is_storm_replay(path: &Path) -> bool {
    path.extension()
        .map(|ext| ext.eq_ignore_ascii_case("StormReplay"))
        .unwrap_or(false)
}
