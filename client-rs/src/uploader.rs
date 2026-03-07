use crate::settings;
use crate::state::{AppEvent, BulkProgress, EventSender, SharedState, UploadStatus};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::time::sleep;

/// Append a line to the log file in the app data directory
fn log(msg: &str) {
    let log_path = settings::data_dir().join("client.log");
    use std::io::Write;
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
    {
        let ts = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
        let _ = writeln!(f, "[{}] {}", ts, msg);
    }
}

const MAX_RETRIES: u32 = 5;
const CONNECTIVITY_INTERVAL: Duration = Duration::from_secs(30);
const CONNECTIVITY_TIMEOUT: Duration = Duration::from_secs(5);

/// Upload a single replay file. Returns the upload result status.
pub async fn upload_file(
    file_path: &Path,
    state: &SharedState,
    tx: &EventSender,
) -> UploadStatus {
    let filename = file_path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    // Skip if already uploaded or in-flight
    {
        let s = state.lock().unwrap();
        if s.uploaded.contains(&filename) {
            return UploadStatus::Duplicate;
        }
    }

    // Skip if server is disconnected — don't burn retries
    {
        let s = state.lock().unwrap();
        if !s.server_connected {
            log(&format!("Skipped {} (server disconnected)", filename));
            return UploadStatus::Skipped;
        }
    }

    let (server_url, auth_token) = {
        let s = state.lock().unwrap();
        (s.server_url.clone(), s.auth_token.clone())
    };

    // Notify upload start
    {
        let mut s = state.lock().unwrap();
        s.add_recent(filename.clone(), UploadStatus::Pending);
        s.request_repaint();
    }
    let _ = tx.send(AppEvent::UploadStart {
        filename: filename.clone(),
    });

    let url = format!("{}/api/upload-raw", server_url.trim_end_matches('/'));
    log(&format!("Uploading {} to {} (auth: {})", filename, url, if auth_token.is_some() { "yes" } else { "no" }));

    let file_path_owned = file_path.to_path_buf();
    let mut last_err = String::new();

    for attempt in 1..=MAX_RETRIES {
        // Use ureq (blocking HTTP) — reqwest's async streaming gets corrupted by Azure ARR proxy
        let url_c = url.clone();
        let filename_c = filename.clone();
        let auth_c = auth_token.clone();
        let path_c = file_path_owned.clone();

        let result = tokio::task::spawn_blocking(move || -> Result<(u16, String), String> {
            let file_bytes = std::fs::read(&path_c)
                .map_err(|e| format!("Read error: {}", e))?;

            let mut req = ureq::post(&url_c)
                .header("Content-Type", "application/octet-stream")
                .header("X-Filename", &filename_c);

            if let Some(ref token) = auth_c {
                req = req.header("Authorization", &format!("Bearer {}", token));
            }

            // send(&[u8]) uses Content-Length (no chunked encoding)
            match req.send(&file_bytes) {
                Ok(mut resp) => {
                    let status = resp.status().as_u16();
                    let body = resp.body_mut().read_to_string()
                        .unwrap_or_default();
                    Ok((status, body))
                }
                Err(ureq::Error::StatusCode(code)) => {
                    Ok((code, format!("HTTP error {}", code)))
                }
                Err(e) => Err(format!("Network error: {}", e)),
            }
        }).await;

        match result {
            Ok(Ok((status_code, body))) => {
                log(&format!("  response: HTTP {} body={}", status_code, &body[..body.len().min(200)]));

                if status_code == 409 {
                    let mut s = state.lock().unwrap();
                    s.uploaded.insert(filename.clone());
                    s.uploaded_count = s.uploaded.len();
                    s.update_recent(&filename, UploadStatus::Duplicate);
                    s.request_repaint();
                    settings::save_uploaded(&s.uploaded);
                    let _ = tx.send(AppEvent::UploadDuplicate {
                        filename: filename.clone(),
                    });
                    log(&format!("Duplicate: {}", filename));
                    return UploadStatus::Duplicate;
                }

                if (200..300).contains(&status_code) {
                    log(&format!("Uploaded: {} -> {}", filename, body));
                    let mut s = state.lock().unwrap();
                    s.uploaded.insert(filename.clone());
                    s.uploaded_count = s.uploaded.len();
                    s.update_recent(&filename, UploadStatus::Success);
                    s.request_repaint();
                    settings::save_uploaded(&s.uploaded);
                    let _ = tx.send(AppEvent::UploadSuccess {
                        filename: filename.clone(),
                    });
                    return UploadStatus::Success;
                }

                last_err = format!("HTTP {}: {}", status_code, body);
                log(&format!("Upload attempt {}/{} for {} failed: {}", attempt, MAX_RETRIES, filename, last_err));
            }
            Ok(Err(e)) => {
                last_err = e.clone();
                log(&format!("Upload attempt {}/{} for {} error: {}", attempt, MAX_RETRIES, filename, e));
            }
            Err(e) => {
                last_err = format!("Task error: {}", e);
                log(&format!("Upload attempt {}/{} for {} error: {}", attempt, MAX_RETRIES, filename, last_err));
            }
        }

        if attempt < MAX_RETRIES {
            let delay = Duration::from_secs((attempt * 2) as u64);
            sleep(delay).await;
        }
    }

    // All retries exhausted
    let err_msg = format!("After {} attempts: {}", MAX_RETRIES, last_err);
    let mut s = state.lock().unwrap();
    s.update_recent_with_error(&filename, UploadStatus::Failed, err_msg.clone());
    s.request_repaint();
    let _ = tx.send(AppEvent::UploadFailed {
        filename: filename.clone(),
        error: err_msg.clone(),
    });
    eprintln!(
        "Failed to upload {} after {} attempts: {}",
        filename, MAX_RETRIES, last_err
    );
    UploadStatus::Failed
}

/// Scan a directory for .StormReplay files and upload any that haven't been uploaded yet.
pub async fn scan_and_upload(
    replay_dir: &Path,
    state: &SharedState,
    tx: &EventSender,
) {
    // Don't scan if server is not connected
    {
        let s = state.lock().unwrap();
        if !s.server_connected {
            log("Scan skipped: server not connected");
            return;
        }
    }

    let entries = match std::fs::read_dir(replay_dir) {
        Ok(e) => e,
        Err(e) => {
            eprintln!("Failed to read replay dir: {}", e);
            return;
        }
    };

    let mut to_upload: Vec<PathBuf> = Vec::new();
    let already_uploaded = {
        let s = state.lock().unwrap();
        s.uploaded.clone()
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if let Some(ext) = path.extension() {
            if ext.eq_ignore_ascii_case("StormReplay") {
                let fname = path
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string();
                if !already_uploaded.contains(&fname) {
                    to_upload.push(path);
                }
            }
        }
    }

    if to_upload.is_empty() {
        println!(
            "All {} replays already uploaded.",
            already_uploaded.len()
        );
        return;
    }

    println!(
        "Uploading {} new replays ({} already uploaded)...",
        to_upload.len(),
        already_uploaded.len()
    );

    let total = to_upload.len();
    let mut done = 0usize;
    let mut failed = 0usize;
    let mut duplicates = 0usize;

    // Send initial bulk progress
    {
        let bp = BulkProgress {
            done: 0,
            failed: 0,
            duplicates: 0,
            total,
        };
        let mut s = state.lock().unwrap();
        s.bulk_progress = Some(bp.clone());
        s.request_repaint();
        let _ = tx.send(AppEvent::BulkProgress(bp));
    }

    for file_path in &to_upload {
        let result = upload_file(file_path, state, tx).await;
        done += 1;

        match result {
            UploadStatus::Duplicate => duplicates += 1,
            UploadStatus::Failed => failed += 1,
            UploadStatus::Skipped => {
                // Server went offline mid-scan — stop trying
                log("Server disconnected during scan, aborting remaining uploads");
                break;
            }
            _ => {}
        }

        let bp = BulkProgress {
            done,
            failed,
            duplicates,
            total,
        };
        {
            let mut s = state.lock().unwrap();
            s.bulk_progress = Some(bp.clone());
            s.request_repaint();
        }
        let _ = tx.send(AppEvent::BulkProgress(bp));

        if done % 50 == 0 || done == total {
            println!("  {}/{}", done, total);
        }
    }

    // Clear bulk progress
    {
        let mut s = state.lock().unwrap();
        s.bulk_progress = None;
        s.request_repaint();
    }
    let _ = tx.send(AppEvent::BulkDone);
}

/// Spawn a background task that periodically checks server connectivity.
pub fn start_connectivity_check(
    state: SharedState,
    tx: EventSender,
    runtime: tokio::runtime::Handle,
) {
    runtime.spawn(async move {
        let client = reqwest::Client::builder()
            .timeout(CONNECTIVITY_TIMEOUT)
            .build()
            .unwrap();

        loop {
            let (url, was_connected) = {
                let s = state.lock().unwrap();
                (s.server_url.clone(), s.server_connected)
            };

            let check_url = format!("{}/api/modes", url.trim_end_matches('/'));
            let is_connected = client.get(&check_url).send().await.map_or(false, |r| r.status().is_success());

            if is_connected != was_connected {
                let mut s = state.lock().unwrap();
                s.server_connected = is_connected;
                s.request_repaint();
                if is_connected {
                    let _ = tx.send(AppEvent::ServerConnected);
                } else {
                    let _ = tx.send(AppEvent::ServerDisconnected);
                }
            }

            sleep(CONNECTIVITY_INTERVAL).await;
        }
    });
}
