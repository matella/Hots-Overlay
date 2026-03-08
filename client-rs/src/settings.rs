use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;

/// Build-time defaults baked by build.rs
const DEFAULT_SERVER_URL: &str = env!("DEFAULT_SERVER_URL");
const DEFAULT_AUTH_TOKEN: &str = env!("DEFAULT_AUTH_TOKEN");

#[derive(Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SettingsFile {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth_token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub replay_dir: Option<String>,
}

/// Resolved settings with layered priority: env > settings.json > build defaults
#[derive(Debug, Clone)]
pub struct Settings {
    pub server_url: String,
    pub auth_token: Option<String>,
    pub replay_dir: Option<String>,
}

/// Returns the data directory for this app.
/// On Windows: %LOCALAPPDATA%/HotS Replay Client/
pub fn data_dir() -> PathBuf {
    let base = dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."));
    let dir = base.join("HotS Replay Client");
    fs::create_dir_all(&dir).ok();
    dir
}

fn settings_path() -> PathBuf {
    data_dir().join("settings.json")
}

pub fn uploaded_path() -> PathBuf {
    data_dir().join("uploaded.json")
}

/// Load settings with layered priority: env > settings.json > build-time defaults
pub fn load() -> Settings {
    // Load settings.json if it exists
    let file_settings = fs::read_to_string(settings_path())
        .ok()
        .and_then(|s| serde_json::from_str::<SettingsFile>(&s).ok())
        .unwrap_or_default();

    // Layer: env > file > build default
    let server_url = std::env::var("SERVER_URL")
        .ok()
        .or(file_settings.server_url)
        .unwrap_or_else(|| DEFAULT_SERVER_URL.to_string());

    let auth_token_raw = std::env::var("AUTH_TOKEN")
        .ok()
        .or(file_settings.auth_token)
        .unwrap_or_else(|| DEFAULT_AUTH_TOKEN.to_string());

    let auth_token = if auth_token_raw.is_empty() {
        None
    } else {
        Some(auth_token_raw)
    };

    let replay_dir = std::env::var("REPLAY_DIR")
        .ok()
        .or(file_settings.replay_dir);

    Settings {
        server_url,
        auth_token,
        replay_dir,
    }
}

/// Save replay directory to settings.json (server_url and auth_token are build-time constants)
pub fn save(replay_dir: &str) -> Result<(), String> {
    let file_settings = SettingsFile {
        server_url: None,
        auth_token: None,
        replay_dir: if replay_dir.is_empty() { None } else { Some(replay_dir.to_string()) },
    };

    let json = serde_json::to_string_pretty(&file_settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;
    fs::write(settings_path(), json)
        .map_err(|e| format!("Failed to write settings: {}", e))
}

/// Load the set of already-uploaded filenames from uploaded.json
pub fn load_uploaded() -> HashSet<String> {
    fs::read_to_string(uploaded_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// Save the set of uploaded filenames to uploaded.json
pub fn save_uploaded(uploaded: &HashSet<String>) {
    if let Ok(json) = serde_json::to_string(uploaded) {
        fs::write(uploaded_path(), json).ok();
    }
}
