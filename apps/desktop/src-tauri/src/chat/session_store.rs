//! Session history persistence: one turn on disk per
//! `~/.folyn/chat-sessions/<session_id>.json`. Pure move from `chat.rs` —
//! no logic changed.

use std::fs;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use super::params::ImageInput;
use super::AssistantImage;

/// One turn on disk. Decoupled from rig's `Message` so the on-disk format
/// stays stable if rig's enums shift between versions. `images` is optional
/// so pre-image session files (just `{role, content}`) deserialize cleanly.
/// For user turns, `images` carries the multimodal input images fed to the
/// provider. For assistant turns, `images` carries the inline image data
/// URLs the model emitted (image-generation models); these are NOT fed
/// back into the provider on history reload — they are display-only.
#[derive(Serialize, Deserialize, Clone)]
pub(super) struct HistoryMsg {
    pub(super) role: String,
    pub(super) content: String,
    /// User-turn multimodal input images (fed to provider on reload).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) images: Option<Vec<ImageInput>>,
    /// Assistant-turn inline images emitted by image-generation models
    /// (display-only; NOT fed back to the provider).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) assistant_images: Option<Vec<AssistantImage>>,
}

/// `~/.folyn/chat-sessions/`, created if missing. Mirrors `extensions_dir` in
/// `extension_commands.rs` — same data-root convention.
fn sessions_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    let dir = home.join(".folyn").join("chat-sessions");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn session_path(app: &AppHandle, session_id: &str) -> Result<std::path::PathBuf, String> {
    // ponytail: session_id is trusted (app-generated), not a user path input,
    // so a plain filename join is fine — no sanitization needed. If it ever
    // becomes user-editable, reject `..`/separators here first.
    let mut p = sessions_dir(app)?;
    p.push(format!("{session_id}.json"));
    Ok(p)
}

pub(super) fn load_history(
    app: &AppHandle,
    session_id: &str,
) -> Result<Vec<HistoryMsg>, String> {
    let path = session_path(app, session_id)?;
    match fs::read(&path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|e| e.to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(e) => Err(e.to_string()),
    }
}

pub(super) fn save_history(
    app: &AppHandle,
    session_id: &str,
    hist: &[HistoryMsg],
) -> Result<(), String> {
    let path = session_path(app, session_id)?;
    let bytes = serde_json::to_vec(hist).map_err(|e| e.to_string())?;
    fs::write(&path, bytes).map_err(|e| e.to_string())
}
