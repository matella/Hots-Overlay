#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app;
mod settings;
mod state;
mod tray;
mod uploader;
mod watcher;
mod win_utils;

use state::{AppState, SharedState};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

fn main() {
    // Load settings (layered: env > settings.json > build defaults)
    let cfg = settings::load();
    let uploaded = settings::load_uploaded();

    println!("Server URL: {}", cfg.server_url);
    println!(
        "Replay dir: {}",
        cfg.replay_dir.as_deref().unwrap_or("(not set)")
    );
    println!("Uploaded count: {}", uploaded.len());

    // Create shared state
    let state: SharedState = Arc::new(Mutex::new(AppState::new(
        cfg.server_url.clone(),
        cfg.auth_token.clone(),
        cfg.replay_dir.clone(),
        uploaded,
    )));

    // Create event channel
    let (tx, rx) = state::event_channel();

    // Build tokio runtime for async tasks
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("Failed to create tokio runtime");
    let rt_handle = runtime.handle().clone();

    // Start connectivity check
    if !cfg.server_url.is_empty() {
        uploader::start_connectivity_check(state.clone(), tx.clone(), rt_handle.clone());
    }

    // Start watcher + scan if replay dir is configured
    let watcher_handle = if let Some(ref dir) = cfg.replay_dir {
        let dir_path = PathBuf::from(dir);
        if dir_path.is_dir() {
            match watcher::start_watcher(dir, state.clone(), tx.clone(), rt_handle.clone()) {
                Ok(handle) => {
                    // Scan in background
                    let state_bg = state.clone();
                    let tx_bg = tx.clone();
                    let dir_bg = dir.clone();
                    rt_handle.spawn(async move {
                        uploader::scan_and_upload(&PathBuf::from(dir_bg), &state_bg, &tx_bg).await;
                    });
                    Some(handle)
                }
                Err(e) => {
                    eprintln!("Failed to start watcher: {}", e);
                    let mut s = state.lock().unwrap();
                    s.watcher_status = state::WatcherStatus::Error(e);
                    None
                }
            }
        } else {
            eprintln!("Replay directory does not exist: {}", dir);
            None
        }
    } else {
        None
    };

    // Create system tray
    let _tray_icon = tray::create_tray();

    // Launch eframe GUI
    let native_options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_title("HotS Replay Client")
            .with_inner_size([700.0, 520.0])
            .with_min_inner_size([500.0, 400.0])
            .with_icon(load_app_icon()),
        ..Default::default()
    };

    let state_gui = state.clone();
    let tx_gui = tx.clone();
    let rt_gui = rt_handle.clone();

    eframe::run_native(
        "HotS Replay Client",
        native_options,
        Box::new(move |_cc| {
            Ok(Box::new(app::ReplayApp::new(
                state_gui,
                tx_gui,
                rx,
                rt_gui,
                watcher_handle,
            )))
        }),
    )
    .expect("Failed to run eframe");
}

fn load_app_icon() -> egui::IconData {
    let icon_bytes = include_bytes!("../assets/icon.png");
    let img = image::load_from_memory(icon_bytes)
        .expect("Failed to load app icon")
        .into_rgba8();
    let (w, h) = img.dimensions();
    egui::IconData {
        rgba: img.into_raw(),
        width: w,
        height: h,
    }
}
