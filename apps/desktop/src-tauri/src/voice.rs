//! Voice input: macOS-only mic capture → Apple Speech transcription →
//! (PR3: cross-app insert + polish orchestration).
//!
//! PR2 wires the real backend — `voice::recorder` (cpal mic → 16kHz mono Int16
//! PCM) + `voice::apple_speech` (`SFSpeechRecognizer` objc2 FFI) — behind the
//! Tauri commands registered in `lib.rs::invoke_handler!`. `voice_insert_text`
//! stays a stub (PR3 fills the CGEvent Cmd+V path).
//!
//! Non-macOS: every command returns `Err("voice input is macOS-only")` so the
//! frontend state machine degrades to the disabled-tooltip branch without a
//! compile error on Windows.
//!
//! State shape mirrors `commands::PetSizeState`: a `std::sync::Mutex<T>` newtype
//! managed via `app.manage(...)` in `lib.rs::setup`. The mutex holds the live
//! `Recorder` (taken out on stop/cancel) + the `AppleSpeechAsr` consumer that
//! buffers PCM between `voice_start` and `voice_stop`. `Arc<AppleSpeechAsr>`
//! is cheap to clone and `Send + Sync` (all-Arc/Mutex inside), so the
//! Recorder's audio thread + the `voice_stop` caller share the same buffer.

use serde::Serialize;
use std::sync::Mutex;
use tauri::Manager;

// PR4: the voice global hotkey is registered/unregistered via the
// `tauri-plugin-global-shortcut` crate (already a dependency for the pet-panel
// toggle). The plugin's single global handler in `lib.rs::with_handler`
// dispatches by HotKey id — the voice HotKey is stored here so the handler can
// recognize it and emit `voice://hotkey-press` / `voice://hotkey-release`
// instead of `pet://shortcut-toggle`. `Shortcut` (= `global_hotkey::HotKey`)
// is `Copy + Send + Sync`, so storing it in a `Mutex` is cheap and safe.
use tauri_plugin_global_shortcut::Shortcut;

// Submodules. `recorder` + `apple_speech` are macOS-only (cpal + objc2 FFI);
// `wav` is pure Rust but only consumed by `apple_speech`, so cfg-gate it too
// to avoid an unused-crate warning on non-macOS. `insertion` is macOS-only
// (CoreGraphics + ApplicationServices FFI). On Windows these `mod`
// declarations resolve to empty modules (the files start with
// `#![cfg(target_os = "macos")]`), so the types below are only referenced
// from the macOS command paths.
#[cfg(target_os = "macos")]
mod apple_speech;
#[cfg(target_os = "macos")]
mod insertion;
#[cfg(target_os = "macos")]
mod recorder;
#[cfg(target_os = "macos")]
mod wav;

/// Result of a `voice_stop` call. `audioPath` is set when the user has
/// "保存语音源文件" enabled — the WAV written under `<vault>/.voice_input/`.
/// Empty transcript → empty string, not an error (user may have stayed
/// silent); errors are returned via the `Err` side of the Tauri command.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceStopResult {
    pub transcript: String,
    pub audio_path: Option<String>,
}

/// Shared state holding the active recording session. `None` = idle.
///
/// `Recorder::stop` consumes `self` (cpal `Stream` is `!Send` so the handle
/// must own the stream's lifetime); the Mutex<Option<...>> + `take()` pattern
/// is the only way to hand ownership from `voice_start` to `voice_stop`
/// across Tauri command boundaries.
///
/// `voice_hotkey` (PR4) holds the currently-registered global push-to-talk
/// accelerator (parsed from the user's `globalHotkey` setting string). `None`
/// = no voice hotkey registered. Read by the `tauri-plugin-global-shortcut`
/// handler in `lib.rs` to dispatch `voice://hotkey-press`/`release` for this
/// HotKey vs `pet://shortcut-toggle` for any other.
pub struct VoiceState {
    inner: Mutex<VoiceInner>,
    voice_hotkey: Mutex<Option<Shortcut>>,
}

/// Internal shape. `asr` is the same `Arc` handed to the recorder thread —
/// `voice_stop` reads the buffered PCM out of it via `transcribe()`.
#[cfg(target_os = "macos")]
struct VoiceInner {
    recorder: Option<recorder::Recorder>,
    asr: std::sync::Arc<apple_speech::AppleSpeechAsr>,
}

#[cfg(not(target_os = "macos"))]
struct VoiceInner;

impl VoiceState {
    /// Construct the idle state. Registered in `lib.rs::setup` via
    /// `app.manage(VoiceState::new())`.
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(VoiceInner::idle()),
            voice_hotkey: Mutex::new(None),
        }
    }

    /// PR4: snapshot of the currently-registered voice hotkey (Copy). `None`
    /// when no voice hotkey is registered. Called by the global-shortcut
    /// handler in `lib.rs` on every Pressed/Released event — uncontended lock,
    /// cheap (a HotKey is a `u32` id + bitflag + `Code`).
    pub fn voice_hotkey(&self) -> Option<Shortcut> {
        self.voice_hotkey.lock().ok().and_then(|guard| *guard)
    }
}

impl Default for VoiceState {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(target_os = "macos")]
impl VoiceInner {
    fn idle() -> Self {
        Self {
            recorder: None,
            asr: std::sync::Arc::new(apple_speech::AppleSpeechAsr::new(None)),
        }
    }

    /// True if a recording is currently active (Recorder not yet stopped).
    fn is_recording(&self) -> bool {
        self.recorder.is_some()
    }
}

#[cfg(not(target_os = "macos"))]
impl VoiceInner {
    fn idle() -> Self {
        Self
    }
}

// ── macOS real implementation ──────────────────────────────────────────────

#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn voice_start(app: tauri::AppHandle) -> Result<(), String> {
    use std::sync::Arc;
    use apple_speech::AppleSpeechAsr;
    use recorder::{Recorder, RecorderError};

    let state = app.state::<VoiceState>();
    let mut inner = state.inner.lock().map_err(|e| format!("voice state poisoned: {e}"))?;

    if inner.is_recording() {
        return Err("voice recording already in progress".into());
    }

    // Fresh ASR consumer per session — `AppleSpeechAsr::transcribe()` clears
    // the buffer on success, but a previous failed/cancelled session may have
    // left stale PCM (cancel keeps the buffer, see openless). A new Arc is
    // cheap and avoids cross-session leakage.
    let asr = Arc::new(AppleSpeechAsr::new(None));
    // Coerce to `Arc<dyn AudioConsumer>` for the recorder (the consumer trait
    // is what the cpal thread actually calls). A second `Arc<AppleSpeechAsr>`
    // is kept in state for `voice_stop`'s `transcribe()` call — the trait
    // object can't be downcast back without `Any`, so we mint two Arcs to
    // the same allocation (cheap: one atomic refcount bump each). The unsized
    // coercion happens on the second `let` binding (Rust won't infer it
    // through `Arc::clone`'s type parameter directly).
    let consumer_typed = Arc::clone(&asr);
    let consumer: Arc<dyn recorder::AudioConsumer> = consumer_typed;
    let (recorder, runtime_rx) = match Recorder::start(consumer) {
        Ok(pair) => pair,
        Err(RecorderError::PermissionDenied) => {
            return Err("麦克风权限被拒绝，请在 系统设置 → 隐私与安全性 → 麦克风 中允许 Quill".into());
        }
        Err(RecorderError::EngineFailed(msg)) => {
            return Err(format!("麦克风启动失败: {msg}"));
        }
    };

    // Drain any stale runtime errors from a previous session so a later
    // `voice_stop` doesn't surface a stale failure.
    let _ = runtime_rx.try_recv();

    inner.recorder = Some(recorder);
    inner.asr = asr;
    log::info!("[voice] recording started");
    Ok(())
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn voice_stop(
    app: tauri::AppHandle,
    save_source: bool,
    source_dir: String,
    vault_path: String,
) -> Result<VoiceStopResult, String> {
    use std::sync::Arc;

    let state = app.state::<VoiceState>();
    let (recorder, asr): (
        Option<recorder::Recorder>,
        Arc<apple_speech::AppleSpeechAsr>,
    ) = {
        let mut inner = state.inner.lock().map_err(|e| format!("voice state poisoned: {e}"))?;
        let recorder = inner.recorder.take();
        if recorder.is_none() {
            // No active recording — still try to drain whatever PCM the
            // consumer has buffered (e.g. a previous cancelled session that
            // left buffer uncleared). Empty buffer → empty transcript, no
            // error (matches openless `transcribe()` short-circuit).
            log::warn!("[voice] voice_stop called with no active recorder");
        }
        (recorder, Arc::clone(&inner.asr))
    };

    // Stop the recorder first (joins the audio thread, releases the mic).
    // Done outside the state lock so a concurrent `voice_cancel` doesn't
    // deadlock against the join.
    if let Some(rec) = recorder {
        rec.stop();
    }
    log::info!("[voice] recording stopped; transcribing (buffered {} ms)", asr.buffer_duration_ms());

    // PR3 source-file save: clone the PCM BEFORE `transcribe()` clears the
    // buffer on success. Failure paths keep the buffer (openless contract),
    // so the clone-or-not doesn't matter there — `transcribe()` clears only
    // on Ok. Saving is best-effort: a write failure surfaces a warning but
    // does NOT fail the whole stop (the transcript is still useful).
    let audio_path = if save_source {
        match save_source_wav(&asr.buffered_pcm(), &source_dir, &vault_path) {
            Ok(p) => Some(p),
            Err(err) => {
                log::warn!("[voice] source audio save failed: {err}");
                None
            }
        }
    } else {
        None
    };

    // `transcribe()` spawns a blocking objc runloop task; `.await` yields the
    // tokio runtime back. On permission denial / recognition failure the
    // anyhow error is surfaced as a user-facing string.
    let transcript = asr.transcribe().await.map_err(|e| format!("语音识别失败: {e:#}"))?;

    Ok(VoiceStopResult {
        transcript: transcript.text,
        audio_path,
    })
}

/// Write `pcm` (16 kHz / mono / Int16-LE) as a WAV to
/// `<vault_path>/<source_dir>/<timestamp>.wav`. Creates the dir if missing.
/// Empty `pcm` → returns `None`-shaped empty path error (caller treats as
/// best-effort skip). Timestamp format: `YYYYMMDD-HHMMSS-<ms>`.
#[cfg(target_os = "macos")]
fn save_source_wav(
    pcm: &[u8],
    source_dir: &str,
    vault_path: &str,
) -> Result<String, String> {
    if pcm.is_empty() {
        return Err("empty PCM buffer".into());
    }
    // ponytail: `source_dir` / `vault_path` come from the frontend (the user's
    // configured source dir + the known vault root). Sanitize against `..` so a
    // misconfigured `../` doesn't escape the vault — defensive at the trust
    // boundary, not because the user is hostile.
    let dir_name = std::path::Path::new(source_dir)
        .file_name()
        .ok_or_else(|| format!("invalid source dir: {source_dir}"))?
        .to_str()
        .ok_or_else(|| format!("source dir not UTF-8: {source_dir}"))?;
    let dir = std::path::Path::new(vault_path).join(dir_name);
    std::fs::create_dir_all(&dir).map_err(|e| format!("create source dir failed: {e}"))?;

    let stamp = timestamp_filename();
    let path = dir.join(format!("{stamp}.wav"));

    let samples: Vec<i16> = pcm
        .chunks_exact(2)
        .map(|c| i16::from_le_bytes([c[0], c[1]]))
        .collect();
    let wav = wav::encode_wav_16k_mono(&samples);
    std::fs::write(&path, &wav).map_err(|e| format!("write source wav failed: {e}"))?;
    log::info!("[voice] source audio saved: {}", path.display());
    path.to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| format!("source wav path not UTF-8: {}", path.display()))
}

/// `YYYYMMDD-HHMMSS-<ms>` in local time. Mirrors openless source-file naming.
#[cfg(target_os = "macos")]
fn timestamp_filename() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let secs = now.as_secs() as i64;
    // ponytail: hand-rolled UTC→Y-M-D-H-M-S avoids pulling in `chrono` for one
    // filename. Civil-from-days algorithm (Howard Hinnant); ms from subsec_nanos.
    let days = secs.div_euclid(86_400);
    let sod = secs.rem_euclid(86_400);
    let (z, days_from_epoch) = (days + 719_468, days);
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if m <= 2 { y + 1 } else { y };
    let hour = sod / 3_600;
    let minute = (sod % 3_600) / 60;
    let second = sod % 60;
    let ms = now.subsec_millis();
    let _ = days_from_epoch;
    format!(
        "{:04}{:02}{:02}-{:02}{:02}{:02}-{:03}",
        year, m, d, hour, minute, second, ms
    )
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn voice_cancel(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<VoiceState>();
    let (recorder, asr) = {
        let mut inner = state.inner.lock().map_err(|e| format!("voice state poisoned: {e}"))?;
        let recorder = inner.recorder.take();
        // Cancel the ASR (clears buffer + cancels any in-flight recognition).
        inner.asr.cancel();
        (recorder, std::sync::Arc::clone(&inner.asr))
    };

    if let Some(rec) = recorder {
        rec.stop();
    }
    // `asr.cancel()` already cleared the buffer; the `asr` Arc drop is a
    // no-op since `voice_start` will mint a fresh one on next session.
    let _ = asr;
    log::info!("[voice] recording cancelled");
    Ok(())
}

// ── Non-macOS stubs ────────────────────────────────────────────────────────
//
// `voice.rs` (this file) is the module root declared in `lib.rs::mod voice;`.
// The macOS submodules (`recorder`, `apple_speech`, `wav`) are cfg-gated to
// `target_os = "macos"` so they don't compile on Windows — but the commands
// below MUST exist on every platform because `lib.rs::invoke_handler!`
// references them unconditionally. Non-macOS returns a clear error so the
// frontend can show the "Windows 暂不支持语音输入" tooltip path.

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub async fn voice_start(_app: tauri::AppHandle) -> Result<(), String> {
    Err("voice input is macOS-only".into())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub async fn voice_stop(
    _app: tauri::AppHandle,
    _save_source: bool,
    _source_dir: String,
    _vault_path: String,
) -> Result<VoiceStopResult, String> {
    Err("voice input is macOS-only".into())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub async fn voice_cancel(_app: tauri::AppHandle) -> Result<(), String> {
    Err("voice input is macOS-only".into())
}

/// Write `text` to the system clipboard and simulate Cmd+V so it lands in
/// the cursor-focused input of the frontmost app (including other apps).
/// Requires Accessibility permission on macOS — see `voice::insertion`.
#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn voice_insert_text(app: tauri::AppHandle, text: String) -> Result<(), String> {
    // ponytail: clipboard read/write can block briefly (arboard locks the
    // pasteboard); run on a blocking worker so the async command doesn't
    // stall the tokio runtime. The CGEvent post is fast (microseconds) but
    // stays in the blocking call for symmetry — it touches system frameworks.
    tauri::async_runtime::spawn_blocking(move || insertion::insert_text(&app, &text))
        .await
        .map_err(|e| format!("voice insert join failed: {e}"))?
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub async fn voice_insert_text(_app: tauri::AppHandle, _text: String) -> Result<(), String> {
    Err("voice input is macOS-only".into())
}

// ── PR4: global push-to-talk hotkey ────────────────────────────────────────
//
// Registers (or replaces, or unregisters) the voice push-to-talk accelerator.
// The frontend calls this on VoiceSettings change + on app mount when a
// hotkey is persisted. The accelerator string follows Tauri's grammar
// (e.g. "Cmd+Shift+V"); empty string = unregister only.
//
// Cross-platform: the `tauri-plugin-global-shortcut` plugin loads on every
// platform, so registration itself works everywhere. The voice flow it
// triggers (`voice_start`/`voice_stop`) is macOS-only — on other platforms
// the Pressed-event handler still emits `voice://hotkey-press`, the
// frontend still calls `invoke('voice_start')`, which returns the macOS-only
// error and surfaces to the user as usual. In practice the frontend guards
// hotkey registration with `onMac` so this is belt-and-suspenders.
//
// Conflicts with the pet-panel toggle (`pet_panel_set_shortcut`, which uses
// `unregister_all`): we do NOT use `unregister_all` here — we unregister only
// the previously-stored voice HotKey, so the pet-panel accelerator survives a
// voice-hotkey change (and vice versa). The two accelerators are independent.

#[tauri::command]
pub async fn voice_set_global_hotkey(
    app: tauri::AppHandle,
    accelerator: String,
) -> Result<(), String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    use std::str::FromStr;

    let state = app.state::<VoiceState>();

    // Unregister the previous voice HotKey (if any). Stored as `Option<Shortcut>`
    // (Copy), so take it under the lock and release the lock before the
    // blocking `unregister` call (which posts to the main thread).
    let prev = state.voice_hotkey.lock().ok().and_then(|mut guard| guard.take());
    if let Some(prev_hotkey) = prev {
        // `unregister` takes `TryInto<ShortcutWrapper>`; `Shortcut` (= HotKey)
        // converts via the `From<Shortcut> for ShortcutWrapper` impl. A stale /
        // already-unregistered HotKey returns Ok (the plugin's internal map
        // just removes nothing).
        let _ = app.global_shortcut().unregister(prev_hotkey);
    }

    if accelerator.trim().is_empty() {
        // Unregister-only path. `voice_hotkey` already cleared to None above.
        return Ok(());
    }

    // Parse the accelerator string into a `Shortcut` (HotKey). We register
    // via the no-handler `register` path — the catch-all `with_handler` in
    // `lib.rs` does ALL dispatch by comparing the fired HotKey against the
    // stored voice HotKey. (Registering with a per-shortcut handler would
    // cause BOTH the per-shortcut handler AND the catch-all to fire per the
    // plugin's event-loop contract, which would double-dispatch.)
    let hotkey = Shortcut::from_str(&accelerator)
        .map_err(|e| format!("invalid voice hotkey '{accelerator}': {e}"))?;
    app.global_shortcut()
        .register(hotkey)
        .map_err(|e| format!("register voice hotkey failed: {e}"))?;

    // Store the parsed HotKey (not the string) so the catch-all can compare
    // by id without re-parsing on every event.
    if let Ok(mut guard) = state.voice_hotkey.lock() {
        *guard = Some(hotkey);
    }
    log::info!("[voice] global hotkey registered: {accelerator}");
    Ok(())
}
