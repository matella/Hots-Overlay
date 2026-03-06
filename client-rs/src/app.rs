use crate::settings;
use crate::state::{
    AppEvent, EventReceiver, EventSender, SharedState, UploadStatus, WatcherStatus,
};
use crate::uploader;
use crate::watcher::{self, WatcherHandle};
use crate::win_utils;
use eframe::egui;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Instant;

// --- Colors ---
const BG_DARK: egui::Color32 = egui::Color32::from_rgb(0x11, 0x18, 0x27);
const BG_PANEL: egui::Color32 = egui::Color32::from_rgb(0x1f, 0x29, 0x37);
const BORDER: egui::Color32 = egui::Color32::from_rgb(0x37, 0x41, 0x51);
const TEXT_PRIMARY: egui::Color32 = egui::Color32::from_rgb(0xf9, 0xfa, 0xfb);
const TEXT_SECONDARY: egui::Color32 = egui::Color32::from_rgb(0x9c, 0xa3, 0xaf);
const TEXT_DIM: egui::Color32 = egui::Color32::from_rgb(0x6b, 0x72, 0x80);
const TEXT_BODY: egui::Color32 = egui::Color32::from_rgb(0xd1, 0xd5, 0xdb);
const GREEN: egui::Color32 = egui::Color32::from_rgb(0x4a, 0xde, 0x80);
const RED: egui::Color32 = egui::Color32::from_rgb(0xf8, 0x71, 0x71);
const AMBER: egui::Color32 = egui::Color32::from_rgb(0xfb, 0xbf, 0x24);
const ORANGE: egui::Color32 = egui::Color32::from_rgb(0xfb, 0x92, 0x3c);
const BLUE: egui::Color32 = egui::Color32::from_rgb(0x3b, 0x82, 0xf6);
const ROW_ALT: egui::Color32 = egui::Color32::from_rgb(0x1a, 0x23, 0x32);
const PROGRESS_TRACK: egui::Color32 = egui::Color32::from_rgb(0x37, 0x41, 0x51);
const SUCCESS_BG: egui::Color32 = egui::Color32::from_rgb(0x06, 0x4e, 0x3b);
const SUCCESS_TEXT: egui::Color32 = egui::Color32::from_rgb(0x6e, 0xe7, 0xb7);
const ERROR_BG: egui::Color32 = egui::Color32::from_rgb(0x7f, 0x1d, 0x1d);
const ERROR_TEXT: egui::Color32 = egui::Color32::from_rgb(0xfc, 0xa5, 0xa5);

pub struct ReplayApp {
    state: SharedState,
    tx: EventSender,
    rx: Arc<Mutex<EventReceiver>>,
    runtime: tokio::runtime::Handle,

    // GUI state
    show_settings: bool,
    settings_replay_dir: String,
    save_message: Option<(String, bool, Instant)>,
    watcher_handle: Option<WatcherHandle>,
}

impl ReplayApp {
    pub fn new(
        state: SharedState,
        tx: EventSender,
        rx: EventReceiver,
        runtime: tokio::runtime::Handle,
        watcher_handle: Option<WatcherHandle>,
    ) -> Self {
        let replay_dir = state
            .lock()
            .unwrap()
            .replay_dir
            .clone()
            .unwrap_or_default();

        Self {
            state,
            tx,
            rx: Arc::new(Mutex::new(rx)),
            runtime,
            show_settings: false,
            settings_replay_dir: replay_dir,
            save_message: None,
            watcher_handle,
        }
    }

    fn drain_events(&mut self) {
        let mut rx = self.rx.lock().unwrap();
        while let Ok(event) = rx.try_recv() {
            match event {
                AppEvent::ServerConnected => {
                    self.state.lock().unwrap().server_connected = true;
                }
                AppEvent::ServerDisconnected => {
                    self.state.lock().unwrap().server_connected = false;
                }
                AppEvent::WatcherStarted => {
                    self.state.lock().unwrap().watcher_status = WatcherStatus::Watching;
                }
                AppEvent::WatcherStopped => {
                    self.state.lock().unwrap().watcher_status = WatcherStatus::Stopped;
                }
                AppEvent::WatcherError(e) => {
                    self.state.lock().unwrap().watcher_status = WatcherStatus::Error(e);
                }
                AppEvent::UploadStart { filename } => {
                    // Use update (not add) — the uploader already added
                    // the Pending entry; this avoids creating a duplicate.
                    let mut s = self.state.lock().unwrap();
                    s.update_recent(&filename, UploadStatus::Pending);
                }
                AppEvent::UploadSuccess { filename } => {
                    let mut s = self.state.lock().unwrap();
                    s.update_recent(&filename, UploadStatus::Success);
                    s.uploaded_count = s.uploaded.len();
                }
                AppEvent::UploadFailed { filename, error } => {
                    self.state.lock().unwrap().update_recent_with_error(&filename, UploadStatus::Failed, error);
                }
                AppEvent::UploadDuplicate { filename } => {
                    let mut s = self.state.lock().unwrap();
                    s.update_recent(&filename, UploadStatus::Duplicate);
                    s.uploaded_count = s.uploaded.len();
                }
                AppEvent::BulkProgress(bp) => {
                    self.state.lock().unwrap().bulk_progress = Some(bp);
                }
                AppEvent::BulkDone => {
                    self.state.lock().unwrap().bulk_progress = None;
                }
            }
        }
    }

    // ── Status bar: single compact row ──────────────────────────────────
    fn render_status_bar(&self, ui: &mut egui::Ui) {
        let s = self.state.lock().unwrap();

        ui.horizontal(|ui| {
            ui.spacing_mut().item_spacing.x = 6.0;

            // Server status
            let (server_color, server_text) = if s.server_connected {
                (GREEN, "Connected")
            } else {
                (RED, "Disconnected")
            };
            Self::status_dot(ui, server_color);
            ui.label(egui::RichText::new("Server:").size(12.0).color(TEXT_DIM));
            ui.label(egui::RichText::new(server_text).size(12.0).color(TEXT_BODY));

            ui.add_space(16.0);

            // Watcher status
            let (watcher_color, watcher_text) = match &s.watcher_status {
                WatcherStatus::Watching => (GREEN, "Watching".to_string()),
                WatcherStatus::Stopped => (AMBER, "Stopped".to_string()),
                WatcherStatus::Error(e) => (RED, format!("Error: {}", e)),
            };
            Self::status_dot(ui, watcher_color);
            ui.label(egui::RichText::new("Watcher:").size(12.0).color(TEXT_DIM));
            ui.label(egui::RichText::new(watcher_text).size(12.0).color(TEXT_BODY));

            // Upload count (right-aligned)
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                ui.label(
                    egui::RichText::new(format!("{} uploaded", s.uploaded_count))
                        .size(12.0)
                        .color(TEXT_SECONDARY),
                );
                Self::status_dot(ui, GREEN);
            });
        });
    }

    fn status_dot(ui: &mut egui::Ui, color: egui::Color32) {
        let (rect, _) = ui.allocate_exact_size(egui::vec2(8.0, 8.0), egui::Sense::hover());
        ui.painter().circle_filled(rect.center(), 4.0, color);
    }

    // ── Bulk progress bar ───────────────────────────────────────────────
    fn render_progress(&self, ui: &mut egui::Ui) {
        let s = self.state.lock().unwrap();
        if let Some(ref bp) = s.bulk_progress {
            let pct = if bp.total > 0 {
                bp.done as f32 / bp.total as f32
            } else {
                0.0
            };

            ui.add_space(4.0);

            // Label
            let mut label = format!("Uploading {}/{}", bp.done, bp.total);
            if bp.duplicates > 0 {
                label.push_str(&format!(" — {} duplicates", bp.duplicates));
            }
            if bp.failed > 0 {
                label.push_str(&format!(" — {} failed", bp.failed));
            }
            ui.label(egui::RichText::new(label).size(11.0).color(TEXT_SECONDARY));

            ui.add_space(3.0);

            // Custom progress bar
            let desired_size = egui::vec2(ui.available_width(), 6.0);
            let (rect, _) = ui.allocate_exact_size(desired_size, egui::Sense::hover());
            let painter = ui.painter();

            // Track
            painter.rect_filled(rect, 3.0, PROGRESS_TRACK);

            // Fill
            let mut fill_rect = rect;
            fill_rect.set_right(rect.left() + rect.width() * pct);
            painter.rect_filled(fill_rect, 3.0, GREEN);

            ui.add_space(4.0);
        }
    }

    // ── Activity log ────────────────────────────────────────────────────
    fn render_activity_log(&self, ui: &mut egui::Ui) {
        let s = self.state.lock().unwrap();
        let recent = s.recent_uploads.clone();
        drop(s);

        ui.add_space(4.0);
        ui.label(egui::RichText::new("RECENT ACTIVITY").size(10.0).color(TEXT_DIM));
        ui.add_space(4.0);

        egui::Frame::new()
            .fill(BG_PANEL)
            .stroke(egui::Stroke::new(1.0, BORDER))
            .corner_radius(8.0)
            .inner_margin(egui::Margin::same(0))
            .show(ui, |ui| {
                egui::ScrollArea::vertical()
                    .auto_shrink([false, false])
                    .show(ui, |ui| {
                        if recent.is_empty() {
                            ui.add_space(40.0);
                            ui.vertical_centered(|ui| {
                                ui.label(
                                    egui::RichText::new("No uploads yet")
                                        .size(13.0)
                                        .color(TEXT_DIM),
                                );
                            });
                            ui.add_space(40.0);
                        } else {
                            for (i, entry) in recent.iter().enumerate() {
                                let row_bg = if i % 2 == 0 { BG_PANEL } else { ROW_ALT };

                                egui::Frame::new()
                                    .fill(row_bg)
                                    .inner_margin(egui::Margin::symmetric(12, 6))
                                    .show(ui, |ui| {
                                        ui.horizontal(|ui| {
                                            ui.spacing_mut().item_spacing.x = 8.0;

                                            // Status dot
                                            let dot_color = match entry.status {
                                                UploadStatus::Success => GREEN,
                                                UploadStatus::Failed => RED,
                                                UploadStatus::Pending => AMBER,
                                                UploadStatus::Duplicate => ORANGE,
                                            };
                                            let (rect, _) = ui.allocate_exact_size(
                                                egui::vec2(8.0, 8.0),
                                                egui::Sense::hover(),
                                            );
                                            ui.painter()
                                                .circle_filled(rect.center(), 4.0, dot_color);

                                            // Filename (fills space)
                                            let label = egui::Label::new(
                                                egui::RichText::new(&entry.filename)
                                                    .size(12.0)
                                                    .color(TEXT_BODY),
                                            )
                                            .truncate()
                                            .wrap_mode(egui::TextWrapMode::Truncate);

                                            let hover_text = if let Some(ref err) = entry.error {
                                                format!("{}\nError: {}", entry.filename, err)
                                            } else {
                                                entry.filename.clone()
                                            };
                                            ui.add(label).on_hover_text(&hover_text);

                                            // Timestamp (right-aligned)
                                            ui.with_layout(
                                                egui::Layout::right_to_left(egui::Align::Center),
                                                |ui| {
                                                    let time =
                                                        entry.timestamp.format("%H:%M").to_string();
                                                    ui.label(
                                                        egui::RichText::new(time)
                                                            .size(11.0)
                                                            .color(TEXT_DIM),
                                                    );
                                                },
                                            );
                                        });
                                    });
                            }
                        }
                    });
            });
    }

    // ── Settings panel ──────────────────────────────────────────────────
    fn render_settings_panel(&mut self, ui: &mut egui::Ui) {
        ui.add_space(8.0);

        // Replay directory
        ui.label(egui::RichText::new("Replay Directory").size(11.0).color(TEXT_DIM));
        ui.add_space(4.0);

        ui.horizontal(|ui| {
            let input = egui::TextEdit::singleline(&mut self.settings_replay_dir)
                .desired_width(ui.available_width() - 160.0)
                .font(egui::TextStyle::Monospace);
            ui.add(input);

            if ui
                .add(
                    egui::Button::new(egui::RichText::new("Browse").size(12.0).color(TEXT_BODY))
                        .fill(BORDER)
                        .min_size(egui::vec2(60.0, 26.0)),
                )
                .clicked()
            {
                if let Some(path) = rfd::FileDialog::new()
                    .set_title("Select Replay Directory")
                    .pick_folder()
                {
                    self.settings_replay_dir = path.to_string_lossy().to_string();
                }
            }

            if ui
                .add(
                    egui::Button::new(
                        egui::RichText::new("Save").size(12.0).color(egui::Color32::WHITE),
                    )
                    .fill(BLUE)
                    .min_size(egui::vec2(60.0, 26.0)),
                )
                .clicked()
            {
                self.save_settings();
            }
        });

        // Status message
        if let Some((ref msg, is_success, time)) = self.save_message {
            if time.elapsed().as_secs() < 5 {
                ui.add_space(6.0);
                let (bg, tc) = if is_success {
                    (SUCCESS_BG, SUCCESS_TEXT)
                } else {
                    (ERROR_BG, ERROR_TEXT)
                };
                egui::Frame::new()
                    .fill(bg)
                    .corner_radius(4.0)
                    .inner_margin(egui::Margin::symmetric(8, 4))
                    .show(ui, |ui| {
                        ui.label(egui::RichText::new(msg).size(11.0).color(tc));
                    });
            }
        }

        ui.add_space(4.0);
    }

    fn save_settings(&mut self) {
        let dir = self.settings_replay_dir.trim().to_string();
        if dir.is_empty() {
            self.save_message = Some((
                "Please enter a replay directory path.".to_string(),
                false,
                Instant::now(),
            ));
            return;
        }

        let path = PathBuf::from(&dir);
        if !path.is_dir() {
            self.save_message = Some((
                format!("Directory does not exist: {}", dir),
                false,
                Instant::now(),
            ));
            return;
        }

        settings::save(&dir);

        {
            let mut s = self.state.lock().unwrap();
            s.replay_dir = Some(dir.clone());
        }

        // Restart watcher
        if let Some(handle) = self.watcher_handle.take() {
            handle.stop();
            self.state.lock().unwrap().watcher_status = WatcherStatus::Stopped;
        }

        match watcher::start_watcher(
            &dir,
            self.state.clone(),
            self.tx.clone(),
            self.runtime.clone(),
        ) {
            Ok(handle) => {
                self.watcher_handle = Some(handle);
            }
            Err(e) => {
                self.state.lock().unwrap().watcher_status = WatcherStatus::Error(e.clone());
                self.save_message = Some((format!("Watcher error: {}", e), false, Instant::now()));
                return;
            }
        }

        // Scan in background
        let state = self.state.clone();
        let tx = self.tx.clone();
        let dir_clone = dir.clone();
        self.runtime.spawn(async move {
            uploader::scan_and_upload(&PathBuf::from(dir_clone), &state, &tx).await;
        });

        self.save_message = Some(("Settings saved.".to_string(), true, Instant::now()));
    }
}

impl eframe::App for ReplayApp {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        // Store ctx for background repaint requests
        {
            let mut s = self.state.lock().unwrap();
            if s.ctx.is_none() {
                s.ctx = Some(ctx.clone());
            }
        }

        // Minimize → hide to tray via Windows API (removes from taskbar)
        if ctx.input(|i| i.viewport().minimized == Some(true)) {
            win_utils::hide_window(win_utils::WINDOW_TITLE);
        }

        self.drain_events();

        // Expire save message
        if let Some((_, _, time)) = &self.save_message {
            if time.elapsed().as_secs() >= 5 {
                self.save_message = None;
            }
        }

        // ── Theme ───────────────────────────────────────────────────────
        let mut visuals = egui::Visuals::dark();
        visuals.panel_fill = BG_DARK;
        visuals.window_fill = BG_DARK;
        visuals.extreme_bg_color = BG_DARK;
        visuals.widgets.noninteractive.bg_fill = BG_PANEL;
        visuals.widgets.inactive.bg_fill = BG_PANEL;
        visuals.widgets.noninteractive.fg_stroke = egui::Stroke::new(1.0, TEXT_SECONDARY);
        visuals.widgets.inactive.fg_stroke = egui::Stroke::new(1.0, TEXT_SECONDARY);
        visuals.selection.bg_fill = BLUE;
        ctx.set_visuals(visuals);

        // ── Header ──────────────────────────────────────────────────────
        egui::TopBottomPanel::top("header")
            .frame(
                egui::Frame::new()
                    .fill(BG_PANEL)
                    .inner_margin(egui::Margin::symmetric(16, 10))
                    .stroke(egui::Stroke::new(1.0, BORDER)),
            )
            .show(ctx, |ui| {
                ui.horizontal(|ui| {
                    ui.label(
                        egui::RichText::new("HotS Replay Client")
                            .size(15.0)
                            .strong()
                            .color(TEXT_PRIMARY),
                    );

                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        let btn_text = if self.show_settings {
                            "Close"
                        } else {
                            "Settings"
                        };
                        let btn = ui.add(
                            egui::Button::new(
                                egui::RichText::new(btn_text).size(12.0).color(TEXT_SECONDARY),
                            )
                            .frame(false),
                        );
                        if btn.clicked() {
                            self.show_settings = !self.show_settings;
                            if self.show_settings {
                                let s = self.state.lock().unwrap();
                                self.settings_replay_dir =
                                    s.replay_dir.clone().unwrap_or_default();
                            }
                        }
                    });
                });
            });

        // ── Settings panel (bottom, conditional) ────────────────────────
        if self.show_settings {
            egui::TopBottomPanel::bottom("settings")
                .frame(
                    egui::Frame::new()
                        .fill(BG_PANEL)
                        .inner_margin(egui::Margin::symmetric(16, 8))
                        .stroke(egui::Stroke::new(1.0, BORDER)),
                )
                .show(ctx, |ui| {
                    self.render_settings_panel(ui);
                });
        }

        // ── Central area ────────────────────────────────────────────────
        egui::CentralPanel::default()
            .frame(
                egui::Frame::new()
                    .fill(BG_DARK)
                    .inner_margin(egui::Margin::symmetric(16, 8)),
            )
            .show(ctx, |ui| {
                self.render_status_bar(ui);
                ui.add_space(2.0);
                ui.separator();
                self.render_progress(ui);
                self.render_activity_log(ui);
            });
    }
}
