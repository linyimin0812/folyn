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
use tauri::{Emitter, Manager, PhysicalPosition};

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
mod permissions;
#[cfg(target_os = "macos")]
mod recorder;
#[cfg(target_os = "macos")]
mod wav;

/// Result of a `voice_stop` call. `audioPath` is set when the user has
/// "保存语音源文件" enabled — the WAV written under `<vault>/.voice_input/`.
/// Empty transcript → empty string, not an error (user may have stayed
/// silent); errors are returned via the `Err` side of the Tauri command.
///
/// `saveError` is a non-fatal warning: when the user asked to save the source
/// WAV but the save failed (empty PCM, vault path missing, permission), the
/// transcript is still returned via `transcript` and the insert flow proceeds;
/// the frontend surfaces `saveError` as a brief inline error on the button
/// (3s red dot) so the user knows the file is missing instead of wondering.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceStopResult {
    pub transcript: String,
    pub audio_path: Option<String>,
    pub save_error: Option<String>,
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
pub async fn voice_start(app: tauri::AppHandle, spoken_locale: String) -> Result<(), String> {
    use std::sync::Arc;
    use apple_speech::AppleSpeechAsr;
    use recorder::{Recorder, RecorderError};

    // Entry-point beacon: confirms the frontend's click-to-start actually
    // reached Rust. `spoken_locale` is logged so a wrong-locale routing
    // (bug #2 in the task PRD — empty locale fell back to system default)
    // is visible without console access.
    log::info!("[voice] voice_start called: spoken_locale={:?}", spoken_locale);

    let state = app.state::<VoiceState>();
    let mut inner = state.inner.lock().map_err(|e| format!("voice state poisoned: {e}"))?;

    if inner.is_recording() {
        return Err("voice recording already in progress".into());
    }

    // Fresh ASR consumer per session — `AppleSpeechAsr::transcribe()` clears
    // the buffer on success, but a previous failed/cancelled session may have
    // left stale PCM (cancel keeps the buffer, see openless). A new Arc is
    // cheap and avoids cross-session leakage.
    //
    // Locale: empty string → None (system default). Otherwise pass the raw
    // Apple locale identifier ("zh-CN", "en-US", …) the frontend picked from
    // the VoiceSettings dropdown. Bug #2 root cause: None fell back to the
    // SYSTEM locale (often English on a Chinese-speaking user), so Chinese
    // speech was routed to the English Apple Speech engine → empty transcript.
    let locale_arg = if spoken_locale.trim().is_empty() {
        None
    } else {
        Some(spoken_locale)
    };
    let asr = Arc::new(AppleSpeechAsr::new(locale_arg));
    // Coerce to `Arc<dyn AudioConsumer>` for the recorder (the consumer trait
    // is what the cpal thread actually calls). A second `Arc<AppleSpeechAsr>`
    // is kept in state for `voice_stop`'s `transcribe()` call — the trait
    // object can't be downcast back without `Any`, so we mint two Arcs to
    // the same allocation (cheap: one atomic refcount bump each). The unsized
    // coercion happens on the second `let` binding (Rust won't infer it
    // through `Arc::clone`'s type parameter directly).
    let consumer_typed = Arc::clone(&asr);
    let consumer: Arc<dyn recorder::AudioConsumer> = consumer_typed;
    // Bug #2 fix: 主动请求麦克风权限（AVAudioApplication / AVCaptureDevice），
    // 而不是依赖 cpal 在 `default_input_config` 调用时的隐式首次提示。后者在
    // `.app` stub 包装（pnpm dev:voice）或用户之前拒绝过 TCC 的场景下不可靠，
    // 导致 cpal 返回 `BackendSpecific` → 被分类为 `PermissionDenied` → 静默
    // 失败，用户看不到录音也无从重试。与 openless `coordinator/dictation.rs`
    // 的 `ensure_microphone_permission` 同源：录音启动前同步请求。Speech
    // recognition 权限由 `apple_speech::ensure_authorized` 在 `transcribe()` 内
    // 请求，本处只管麦克风这条链路。
    if let Err(err) = permissions::ensure_microphone() {
        return Err(err);
    }
    // Mic-level feed for the SiriGL waveform shader. The handler emits a
    // `voice://mic-level` event with `{ level: f32 }` (RMS, 0..1) on every
    // cpal callback throttled to ~30 Hz inside the recorder. Tauri's emit is
    // non-blocking (posts to an internal event bus), so it is safe to call
    // from the real-time audio thread — matches the openless capsule:state
    // emit pattern (see openless `coordinator/capsule_focus.rs`).
    let app_for_level = app.clone();
    let level_handler: Option<recorder::LevelHandler> = Some(std::sync::Arc::new(move |level: f32| {
        let _ = app_for_level.emit("voice://mic-level", serde_json::json!({ "level": level }));
    }));
    let (recorder, runtime_rx) = match Recorder::start(consumer, level_handler) {
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

    // Reveal the voice-orb window (the SiriGL waveform) now that recording is
    // actually live. The window is created hidden at startup (see
    // tauri.conf.json `voice-orb`) and converted to a nonactivating NSPanel on
    // app launch (see `pet_panel_macos::convert_windows`). Position is re-
    // computed bottom-center of the primary monitor on every start so a
    // monitor-layout change since startup is respected. The frontend's
    // VoiceOrbApp hides the window when phase returns to idle/error.
    show_voice_orb(&app);
    Ok(())
}

/// Show the `voice-orb` window at the bottom-center of the primary monitor and
/// reveal it. Called from `voice_start` after the recorder is live. No-op if
/// the window is missing (e.g. non-macOS where the macOS-only `#[cfg]` block
/// is not compiled in). The window's NSPanel conversion + transparency flags
/// were applied at app startup via `pet_panel_macos::convert_windows` +
/// `pet_make_transparent`, so this just sets position + shows.
///
/// ponytail: positioning uses Tauri's `Monitor` API (full monitor rect, NOT
/// `NSScreen.visibleFrame`), so the orb may overlap the Dock on macOS. The
/// orb is short-lived (recording duration only) and transparent; a small
/// bottom margin clears the menu bar on most setups. Upgrade to
/// `NSScreen.visibleFrame` via the cocoa FFI (see `commands::pet_get_work_area`)
/// if Dock overlap becomes visible.
#[cfg(target_os = "macos")]
fn show_voice_orb(app: &tauri::AppHandle) {
    use tauri::PhysicalSize;
    const VOICE_ORB_WIDTH: f64 = 460.0;
    const VOICE_ORB_HEIGHT: f64 = 180.0;
    const BOTTOM_MARGIN_PX: f64 = 40.0;

    let window = match app.get_webview_window("voice-orb") {
        Some(w) => w,
        None => {
            log::warn!("[voice] voice-orb window not found");
            return;
        }
    };

    // ponytail: every NSWindow mutation below — `set_position`, `set_size`, and
    // the NSPanel `show()` (= `orderFrontRegardless`) reached via
    // `show_voice_orb_no_activate` — MUST run on the macOS main thread. `voice_start`
    // is a `#[tauri::command] async fn`, so it executes on a tokio worker thread;
    // calling `WebviewWindow::set_position` / `set_size` or `Panel::show` from there
    // trips AppKit's `NSWMWindowCoordinator performTransactionUsingBlock:` main-thread
    // guard, which `os_crash("Must only be used from the main thread")`s the process
    // (EXC_BREAKPOINT / SIGTRAP) — observed in the field after the user granted
    // Accessibility permission. Marshal the whole window-mutation block to the main
    // thread via `run_on_main_thread` (fire-and-forget; `voice_start` doesn't need
    // to wait — the orb appearing one frame later is fine). Monitor geometry is read
    // here (on the tokio thread) because `app.primary_monitor()` is not main-thread-
    // only and the params are plain `i32`s that are trivially `Send + 'static`.
    let monitor = app.primary_monitor().ok().flatten();
    let have_monitor = monitor.is_some();
    let (x, y, win_w_phys, win_h_phys) = match &monitor {
        Some(m) => {
            let scale = m.scale_factor();
            let mon_pos = m.position();
            let mon_size = m.size();
            let win_w_phys = (VOICE_ORB_WIDTH * scale) as i32;
            let win_h_phys = (VOICE_ORB_HEIGHT * scale) as i32;
            let bottom_phys = (BOTTOM_MARGIN_PX * scale) as i32;
            let x = mon_pos.x + ((mon_size.width as i32) - win_w_phys) / 2;
            let y = mon_pos.y + (mon_size.height as i32) - win_h_phys - bottom_phys;
            (x, y, win_w_phys, win_h_phys)
        }
        None => (0, 0, 0, 0),
    };

    let app2 = app.clone();
    let _ = app.run_on_main_thread(move || {
        if have_monitor {
            // Position FIRST so the first visible frame is already at the right
            // spot (mirrors the pet-panel open path — no flash at the default
            // origin).
            let _ = window.set_position(PhysicalPosition::new(x, y));
            // The conf-declared size is logical points (460×180). Re-assert in
            // physical px so a monitor with a different scale_factor doesn't squish.
            let _ = window.set_size(PhysicalSize::new(win_w_phys, win_h_phys));
        }
        // ponytail: do NOT use `window.show()` — on an NSPanel-converted window
        // it routes through wry/tao's default show path which calls
        // `makeKeyAndOrderFront:`, making the orb the KEY window of the active
        // app (Quill itself when the user clicked the mic button; or, on the
        // global-hotkey path, the orb would steal key from VS Code/the browser
        // the user is dictating into). The post-recording CGEvent Cmd+V posted
        // to `kCGHIDEventTap` is dispatched to the active app's key window — if
        // that is the orb (no text field), nothing lands; the user sees "didn't
        // paste anywhere". Port openless's `show_capsule_window_no_activate`
        // pattern: call the NSPanel's `show()` directly, which does
        // `orderFrontRegardless` — non-activating, non-key-stealing. The orb
        // appears over the user's frontmost app without disturbing key focus,
        // so the subsequent Cmd+V lands at the user's actual cursor. The panel
        // handle is registered in `WebviewPanelManager` by `convert_windows` at
        // startup (`window.to_panel::<QuillPetPanel>()`); we retrieve it here.
        // Fall back to `window.show()` only if the panel isn't registered (e.g.
        // backend=legacy or convert failed) — the orb still appears, paste may
        // still be wrong, but at least the user sees recording feedback.
        show_voice_orb_no_activate(&app2, &window);
    });
}

/// Show the orb via the NSPanel's `show()` (= `orderFrontRegardless`) —
/// non-activating, non-key-stealing. If the panel handle isn't registered
/// (convert failed at startup — should not happen), we log and bail: the orb
/// won't show, but paste still works. We do NOT fall back to `window.show()`
/// because it `makeKeyAndOrderFront:`s, which steals key focus from the
/// foreground app the user is dictating into — that is the root cause of the
/// "Cmd+V didn't paste anywhere" release-build bug.
#[cfg(target_os = "macos")]
fn show_voice_orb_no_activate(app: &tauri::AppHandle, _window: &tauri::WebviewWindow) {
    use tauri_nspanel::ManagerExt;
    match app.get_webview_panel("voice-orb") {
        Ok(panel) => panel.show(),
        Err(e) => {
            log::error!(
                "[voice] voice-orb panel not registered: {:?}. Orb won't show; \
                 panel conversion must have failed at startup. Paste may still work.",
                e
            );
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn show_voice_orb(_app: &tauri::AppHandle) {
    // Non-macOS: voice flow is gated to macOS-only; this helper is never
    // reached on Windows because `voice_start` returns the macOS-only error
    // before calling it. Stub kept so the call site compiles unchanged.
}

/// Hide the `voice-orb` window. Called by the frontend VoiceOrbApp via
/// `invoke('voice_orb_hide')` when the phase transitions to idle or error —
/// the Rust `voice_start` SHOWS the window, but `voice_stop` does NOT hide it
/// (transcribe → polish → insert phases follow `voice_stop`, all of which
/// the orb must stay visible for). Frontend owns the hide because the
/// transcribing/polishing/inserting phases are frontend-only state.
#[tauri::command]
pub async fn voice_orb_hide(app: tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("voice-orb")
        .ok_or_else(|| "voice-orb window not found".to_string())?;
    // ponytail: `window.hide()` mutates NSWindow state and MUST run on the
    // macOS main thread — same class of crash as `show_voice_orb` if called
    // from this tokio worker thread (`os_crash("Must only be used from the
    // main thread")`). Marshal via `run_on_main_thread`; fire-and-forget is
    // fine (frontend treats hide as best-effort).
    let _ = app.run_on_main_thread(move || {
        let _ = window.hide();
    });
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

    // Entry-point beacon: tells us (a) voice_stop was actually invoked from the
    // frontend click, (b) what save_source value the frontend passed (false →
    // no folder will be created THIS run, no saveError, no files — that's the
    // bug-1 paradox if the user expected files), and (c) what vault_path arrived
    // (catches resolveBasePath / tilde-expansion bugs at the boundary).
    log::info!(
        "[voice] voice_stop called: save_source={}, source_dir={:?}, vault_path={:?}",
        save_source,
        source_dir,
        vault_path
    );

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
    // on Ok. A save failure does NOT fail the whole stop (transcript is still
    // useful); the error string is surfaced to the frontend via
    // `VoiceStopResult.save_error` so it can flash a brief inline error.
    //
    // Bug #1: an empty `vault_path` previously fell through to
    // `Path::new("").join(".voice_input")` = `.voice_input` (relative), which
    // landed in the process CWD — wherever the .app was launched from — NOT
    // the vault. The user couldn't find the file. Guard it: refuse the save
    // and surface a clear error so the user knows why.
    let (audio_path, save_error) = if save_source {
        if vault_path.trim().is_empty() {
            log::warn!("[voice] save_source requested but vault_path is empty");
            (None, Some("未配置 vault 路径,无法保存语音源文件".to_string()))
        } else {
            match save_source_wav(&asr.buffered_pcm(), &source_dir, &vault_path) {
                Ok(p) => (Some(p), None),
                Err(err) => {
                    log::warn!("[voice] source audio save failed: {err}");
                    (None, Some(err))
                }
            }
        }
    } else {
        (None, None)
    };

    // `transcribe()` spawns a blocking objc runloop task; `.await` yields the
    // tokio runtime back. On permission denial / recognition failure the
    // anyhow error is surfaced as a user-facing string.
    let transcript = asr.transcribe().await.map_err(|e| format!("语音识别失败: {e:#}"))?;

    Ok(VoiceStopResult {
        transcript: transcript.text,
        audio_path,
        save_error,
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
    let wav_bytes = wav.len();
    std::fs::write(&path, &wav).map_err(|e| format!("write source wav failed: {e}"))?;

    // ponytail: sidecar diagnostic so the user can verify the save without
    // console access. dev:voice uses `open` to launch the .app, so
    // log::info! output is invisible to the user (goes to system log, only
    // readable via Console.app). Writing a sibling .txt puts the facts on
    // disk in the same folder the user is already checking. Delete this
    // once the source-save bug is resolved — it's debug scaffolding, not
    // a runtime feature.
    let diag_path = dir.join(format!("{stamp}.txt"));
    let diag = format!(
        "voice source save\n\
         stamp: {stamp}\n\
         vault_path (resolved): {vault_path}\n\
         source_dir: {source_dir}\n\
         dir_name (extracted): {dir_name}\n\
         final dir: {}\n\
         final wav path: {}\n\
         pcm bytes: {}\n\
         pcm samples (i16): {}\n\
         wav bytes (with header): {wav_bytes}\n\
         write result: Ok\n",
        dir.display(),
        path.display(),
        pcm.len(),
        samples.len(),
    );
    if let Err(err) = std::fs::write(&diag_path, diag) {
        log::warn!("[voice] failed to write sidecar diagnostic: {err}");
    }

    log::info!("[voice] source audio saved: {} ({} bytes)", path.display(), wav_bytes);
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
pub async fn voice_start(_app: tauri::AppHandle, _spoken_locale: String) -> Result<(), String> {
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
    // Hide the voice-orb BEFORE posting Cmd+V. The orb is a Dock-level
    // non-activating NSPanel with `can_become_key_window: false` (see
    // `QuillVoiceOrbPanel`), so it should never be the key window that
    // receives the Cmd+V event — but hiding it first is defense-in-depth and
    // matches openless `hide_capsule_window_if_present` before `inserter.insert`.
    // `run_on_main_thread` is fire-and-forget on a non-main tokio worker; the
    // 50 ms sleep gives the hide a chance to land on the run loop before the
    // CGEvent post (the orb is non-activating, so hide doesn't restore focus
    // to the user's dictation target, but removing the Dock-level overlay from
    // the event-tap path is the fix).
    let app_for_hide = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(w) = app_for_hide.get_webview_window("voice-orb") {
            let _ = w.hide();
        }
    });
    // Brief yield so the hide actually lands on the run loop before paste.
    std::thread::sleep(std::time::Duration::from_millis(50));

    // ponytail: clipboard read/write can block briefly (arboard locks the
    // pasteboard); run on a blocking worker so the async command doesn't
    // stall the tokio runtime. The CGEvent post is fast (microseconds) but
    // stays in the blocking call for symmetry — it touches system frameworks.
    tauri::async_runtime::spawn_blocking(move || insertion::insert_text(&app, &text))
        .await
        .map_err(|e| format!("voice insert join failed: {e}"))?
}

/// Proactively request macOS Accessibility permission by popping the system
/// prompt. The frontend calls this from VoiceSettings (or on first voice-enable)
/// so the user gets a chance to grant BEFORE the first insert — otherwise
/// `voice_insert_text` would surface the permission error only after a full
/// record → transcribe → polish cycle, which feels broken. Uses
/// `AXIsProcessTrustedWithOptions({prompt: true})` (the openless port in
/// `voice::permissions`). Returns true if already granted OR granted after
/// the prompt; false if still not trusted (user declined / closed the dialog
/// without granting).
///
/// This command ALWAYS fires the system dialog (when not yet trusted) — it
/// resets `insertion::ACCESSIBILITY_PROMPTED` before calling
/// `request_accessibility` so the button acts as an explicit "re-trigger the
/// prompt" affordance, bypassing the per-session cap that the `post_cmd_v`
/// hot path enforces. The hot path auto-prompts at most once per process so
/// repeat inserts don't pop the dialog; the button is the user-facing escape
/// hatch for "I dismissed the first prompt, let me try again".
#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn voice_request_accessibility() -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(|| {
        insertion::reset_accessibility_prompt_guard();
        permissions::request_accessibility();
        Ok::<bool, String>(permissions::check_accessibility())
    })
    .await
    .map_err(|e| format!("voice_request_accessibility join failed: {e}"))?
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub async fn voice_insert_text(_app: tauri::AppHandle, _text: String) -> Result<(), String> {
    Err("voice input is macOS-only".into())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub async fn voice_request_accessibility() -> Result<bool, String> {
    // Non-macOS: no Accessibility concept; report "not applicable" as false so
    // the frontend can short-circuit its permission UI the same way as a denied
    // macOS user (the voice flow is gated to macOS-only anyway).
    Ok(false)
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
