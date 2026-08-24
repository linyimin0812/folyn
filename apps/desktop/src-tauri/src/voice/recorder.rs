//! Microphone capture: cpal stream → 16 kHz mono Int16-LE PCM → `AudioConsumer`.
//! Minimal port of openless `recorder.rs` (PR2 scope):
//! - Output fixed at 16 kHz / mono / 16-bit little-endian.
//! - Multi-channel input → arithmetic-mean downmix to mono.
//! - Non-16 kHz input → linear-interpolation resampling with cross-buffer state.
//! - Stream runs in a dedicated thread (cpal `Stream` is `!Send`); `stop()` is
//!   the explicit teardown path.
//!
//! Skipped from openless (separable, not needed for PR2): WavArchiver (source
//! file save is PR3), liveness watchdog (openless-specific error recovery),
//! level metering UI. PR3 will add the level handler + archiver when wiring
//! `VoiceInputButton` recording state + source file save.

// macOS-only: the Windows voice path uses WinRT's own mic capture (no cpal
// PCM buffer), so `voice.rs` gates `mod recorder` to `target_os = "macos"`;
// this inner cfg keeps the file self-describing (same pattern as
// `winrt_speech.rs`'s `#![cfg(target_os = "windows")]`).
#![cfg(target_os = "macos")]

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::Instant;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, StreamConfig};
use parking_lot::Mutex;

/// Target sample rate (must match the WAV header in `wav.rs`).
const TARGET_SAMPLE_RATE: u32 = 16_000;
/// How often to log a diagnostic line (every N callbacks).
const LOG_EVERY_N_CALLBACKS: usize = 50;
/// Min interval between two `level_handler` invocations. cpal callbacks run
/// ~100 Hz (10 ms chunks); piping every RMS to Tauri's event bus would flood
/// the IPC. 33 ms ≈ 30 Hz matches the openless capsule feed rate, which the
/// SiriGL shader's internal attack/release smoothing is tuned for.
const LEVEL_EMIT_INTERVAL_MS: u64 = 33;

/// Receives the resampled 16 kHz mono Int16-LE PCM byte stream. Mirrors the
/// openless trait of the same name; `AppleSpeechAsr` implements it to buffer
/// PCM for `SFSpeechURLRecognitionRequest`.
pub trait AudioConsumer: Send + Sync {
    /// `pcm` is always a sequence of little-endian Int16 samples (length is a
    /// multiple of 2).
    fn consume_pcm_chunk(&self, pcm: &[u8]);
}

/// Optional mic-level callback invoked from the cpal audio thread at
/// ~30 Hz (see `LEVEL_EMIT_INTERVAL_MS`). `level` is the RMS amplitude
/// (0.0..1.0) of the resampled mono PCM for the chunk(s) since the last
/// invocation. Used by the frontend to drive the SiriGL waveform shader.
///
/// The handler MUST be cheap (no synchronous IPC blocking) — it is called
/// from the real-time audio thread. Tauri's `app.emit` is non-blocking
/// (posts to an internal bus), so the typical handler is a one-line emit.
pub type LevelHandler = Arc<dyn Fn(f32) + Send + Sync + 'static>;

/// Recorder errors surfaced via the runtime channel or returned from `start`.
#[derive(Debug)]
pub enum RecorderError {
    /// Microphone permission denied (macOS privacy gate).
    PermissionDenied,
    /// cpal engine failure with the underlying message.
    EngineFailed(String),
}

/// Recorder handle. Drop does NOT stop the stream — call `stop()` explicitly
/// (consumes `self`, mirrors the openless one-shot semantics).
pub struct Recorder {
    stop_flag: Arc<AtomicBool>,
    join_handle: Mutex<Option<JoinHandle<()>>>,
}

impl Recorder {
    /// Start capturing. `consumer` receives 16 kHz / mono / Int16-LE PCM.
    /// `level_handler`, if provided, is invoked at ~30 Hz with the RMS amplitude
    /// of the captured mono PCM — the frontend feeds it to the SiriGL shader.
    /// Returns the recorder + a runtime-error receiver.
    pub fn start(
        consumer: Arc<dyn AudioConsumer>,
        level_handler: Option<LevelHandler>,
    ) -> Result<(Self, Receiver<RecorderError>), RecorderError> {
        // Startup signal: child thread reports Stream-constructed-or-failed.
        let (startup_tx, startup_rx) = channel::<Result<(), RecorderError>>();
        // Runtime errors: surfaced asynchronously via cpal's err_cb.
        let (runtime_error_tx, runtime_error_rx) = channel::<RecorderError>();
        let stop_flag = Arc::new(AtomicBool::new(false));
        let stop_for_thread = Arc::clone(&stop_flag);

        let join_handle = thread::Builder::new()
            .name("folyn-voice-recorder".into())
            .spawn(move || {
                run_audio_thread(consumer, level_handler, stop_for_thread, startup_tx, runtime_error_tx);
            })
            .map_err(|e| RecorderError::EngineFailed(format!("spawn audio thread: {e}")))?;

        let startup_result = startup_rx
            .recv()
            .map_err(|e| RecorderError::EngineFailed(format!("audio thread vanished: {e}")))?;
        startup_result?;

        Ok((
            Self {
                stop_flag,
                join_handle: Mutex::new(Some(join_handle)),
            },
            runtime_error_rx,
        ))
    }

    /// Stop capture and wait for the audio thread to exit.
    pub fn stop(self) {
        self.stop_flag.store(true, Ordering::SeqCst);
        if let Some(handle) = self.join_handle.lock().take() {
            if let Err(err) = handle.join() {
                log::warn!("[voice] recorder thread join failed: {:?}", err);
            }
        }
    }
}

/// Audio thread body: build stream → report startup → loop on stop_flag →
/// `pause()` + drop stream (cpal 0.15 on macOS needs explicit pause before drop
/// to actually release the mic — same fix as openless).
fn run_audio_thread(
    consumer: Arc<dyn AudioConsumer>,
    level_handler: Option<LevelHandler>,
    stop_flag: Arc<AtomicBool>,
    startup_tx: Sender<Result<(), RecorderError>>,
    runtime_error_tx: Sender<RecorderError>,
) {
    let stream = match build_input_stream(consumer, level_handler, runtime_error_tx.clone()) {
        Ok(s) => s,
        Err(err) => {
            let _ = startup_tx.send(Err(err));
            return;
        }
    };

    if let Err(err) = stream.play() {
        let _ = startup_tx.send(Err(RecorderError::EngineFailed(format!("play: {err}"))));
        return;
    }

    let _ = startup_tx.send(Ok(()));

    // Spin until stop_flag. cpal has no wait API; 50ms sleep is plenty.
    while !stop_flag.load(Ordering::SeqCst) {
        thread::sleep(std::time::Duration::from_millis(50));
    }

    // Explicit pause before drop: cpal 0.15 on macOS coreaudio does NOT call
    // AudioOutputUnitStop on drop, leaving the render callback running and the
    // mic orange dot lit. `pause()` goes through StreamTrait::pause →
    // AudioOutputUnitStop synchronously.
    if let Err(err) = stream.pause() {
        log::warn!("[voice] cpal Stream pause before drop failed: {err}");
    }
    drop(stream);
    log::info!("[voice] cpal Stream dropped (mic released)");
}

fn build_input_stream(
    consumer: Arc<dyn AudioConsumer>,
    level_handler: Option<LevelHandler>,
    runtime_error_tx: Sender<RecorderError>,
) -> Result<cpal::Stream, RecorderError> {
    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or_else(|| RecorderError::EngineFailed("no default input device".into()))?;

    let supported = device
        .default_input_config()
        .map_err(|e| classify_default_config_err(e.to_string()))?;
    let sample_format = supported.sample_format();
    let config: StreamConfig = supported.config();
    let input_sr = config.sample_rate.0;
    let channels = config.channels as usize;

    log::info!(
        "[voice] inputDevice={} inputFormat sampleRate={} channels={} fmt={:?}",
        device.name().unwrap_or_else(|_| "<unknown>".into()),
        input_sr,
        channels,
        sample_format
    );

    let state = Arc::new(StreamState::new(level_handler));
    build_stream_for_format(
        &device,
        &config,
        sample_format,
        consumer,
        Arc::clone(&state),
        input_sr,
        channels,
        runtime_error_tx,
    )
}

/// `SupportedStreamConfig` → concrete build call per sample format. Only the
/// cpal-common float/integer formats; others fall back to an error.
fn build_stream_for_format(
    device: &cpal::Device,
    config: &StreamConfig,
    sample_format: SampleFormat,
    consumer: Arc<dyn AudioConsumer>,
    state: Arc<StreamState>,
    input_sr: u32,
    channels: usize,
    runtime_error_tx: Sender<RecorderError>,
) -> Result<cpal::Stream, RecorderError> {
    macro_rules! make_stream {
        ($t:ty, $to_f32:expr) => {{
            let consumer = Arc::clone(&consumer);
            let state = Arc::clone(&state);
            let runtime_error_tx = runtime_error_tx.clone();
            let err_cb = move |err| {
                log::error!("[voice] stream error: {err}");
                let _ = runtime_error_tx.send(RecorderError::EngineFailed(format!("stream: {err}")));
            };
            device
                .build_input_stream::<$t, _, _>(
                    config,
                    move |data: &[$t], _info| {
                        let mut floats = Vec::with_capacity(data.len());
                        for s in data {
                            floats.push($to_f32(*s));
                        }
                        process_callback(&floats, channels, input_sr, consumer.as_ref(), &state);
                    },
                    err_cb,
                    None,
                )
                .map_err(classify_build_stream_err)
        }};
    }

    match sample_format {
        SampleFormat::F32 => make_stream!(f32, |s: f32| s),
        SampleFormat::I16 => make_stream!(i16, |s: i16| s as f32 / i16::MAX as f32),
        SampleFormat::U16 => make_stream!(u16, |s: u16| (s as f32 - 32768.0) / 32768.0),
        SampleFormat::I32 => make_stream!(i32, |s: i32| s as f32 / i32::MAX as f32),
        SampleFormat::I8 => make_stream!(i8, |s: i8| s as f32 / i8::MAX as f32),
        SampleFormat::U8 => make_stream!(u8, |s: u8| (s as f32 - 128.0) / 128.0),
        other => Err(RecorderError::EngineFailed(format!(
            "unsupported sample format: {other:?}"
        ))),
    }
}

/// Startup-time default_input_config failure: keyword-classify permission vs
/// engine. cpal on macOS without mic authorization returns `BackendSpecific`,
/// which we try to recognize.
fn classify_default_config_err(msg: String) -> RecorderError {
    let lower = msg.to_lowercase();
    if lower.contains("permission") || lower.contains("denied") || lower.contains("authoriz") {
        RecorderError::PermissionDenied
    } else {
        RecorderError::EngineFailed(format!("default_input_config: {msg}"))
    }
}

// ponytail: string-match the BuildStreamError message — cpal 0.15 doesn't
// expose typed variants for permission denial (the variant is
// `BackendSpecific { err }` carrying the OS error string). Windows WASAPI
// returns "Access is denied." (contains "denied") when the user blocked the
// mic, so the keyword catch holds. Ceiling: if cpal adds a typed
// `PermissionDenied` variant in a future release, switch to it (more robust
// than string-match against an unstable OS-formatted message).
fn classify_build_stream_err(err: cpal::BuildStreamError) -> RecorderError {
    let msg = err.to_string();
    let lower = msg.to_lowercase();
    if lower.contains("permission") || lower.contains("denied") || lower.contains("authoriz") {
        RecorderError::PermissionDenied
    } else {
        RecorderError::EngineFailed(format!("build_input_stream: {msg}"))
    }
}

/// Cross-callback state for resampling + diagnostics + level throttling.
struct StreamState {
    resample_phase: Mutex<f64>,
    last_sample: Mutex<f32>,
    callback_count: AtomicU64,
    /// Last `Instant` the level handler was invoked. Pinned to the audio
    /// thread (cpal calls back on its own thread), but stored as `Mutex<Instant>`
    /// so the `Fn(f32)` handler can be reassigned per-session without unsafe.
    last_level_emit: Mutex<Instant>,
    /// Optional mic-level handler (~30 Hz). `None` = no UI feed (level metering
    /// disabled); the consumer still gets the PCM as usual.
    level_handler: Option<LevelHandler>,
}

impl StreamState {
    fn new(level_handler: Option<LevelHandler>) -> Self {
        Self {
            resample_phase: Mutex::new(0.0),
            last_sample: Mutex::new(0.0),
            callback_count: AtomicU64::new(0),
            last_level_emit: Mutex::new(Instant::now()),
            level_handler,
        }
    }
}

/// Per callback: downmix → resample → quantize to i16 → feed consumer, then
/// (optionally) feed the level handler with the chunk's RMS, throttled to
/// ~30 Hz so the IPC bus isn't flooded.
fn process_callback(
    interleaved: &[f32],
    channels: usize,
    input_sr: u32,
    consumer: &dyn AudioConsumer,
    state: &StreamState,
) {
    if interleaved.is_empty() || channels == 0 {
        return;
    }

    let mono = downmix_to_mono(interleaved, channels);
    let resampled = resample_to_target(&mono, input_sr, TARGET_SAMPLE_RATE, state);
    if resampled.is_empty() {
        return;
    }

    let (pcm_bytes, output_rms) = quantize_to_i16_le(&resampled);
    consumer.consume_pcm_chunk(&pcm_bytes);

    // Mic-level feed for the SiriGL waveform shader. Throttled: cpal calls
    // back ~100 Hz, but the shader's internal attack/release smoothing makes
    // 30 Hz plenty — same rate as openless's capsule:state feed. The handler
    // is invoked outside the resample/quantize critical path so a slow IPC
    // can't stall the audio thread (Tauri's emit is non-blocking).
    if let Some(handler) = state.level_handler.as_ref() {
        let mut last_emit = state.last_level_emit.lock();
        let elapsed = last_emit.elapsed();
        if elapsed.as_millis() as u64 >= LEVEL_EMIT_INTERVAL_MS {
            *last_emit = Instant::now();
            drop(last_emit);
            handler(output_rms);
        }
    }

    let count = state.callback_count.fetch_add(1, Ordering::Relaxed) + 1;
    if count == 1 || count % LOG_EVERY_N_CALLBACKS as u64 == 0 {
        log::info!("[voice] cb#{count} inLen={} outLen={}", mono.len(), resampled.len());
    }
}

/// Multi-channel interleaved samples → mono (arithmetic mean).
fn downmix_to_mono(interleaved: &[f32], channels: usize) -> Vec<f32> {
    if channels == 1 {
        return interleaved.to_vec();
    }
    let frames = interleaved.len() / channels;
    let mut out = Vec::with_capacity(frames);
    for i in 0..frames {
        let base = i * channels;
        let mut sum = 0.0f32;
        for c in 0..channels {
            sum += interleaved[base + c];
        }
        out.push(sum / channels as f32);
    }
    out
}

/// Linear-interpolation resampling to target rate, state preserved across
/// buffers. Uses the previous callback's last sample as the virtual index -1
/// sample, and a fractional `phase` to track position.
fn resample_to_target(samples: &[f32], src_sr: u32, dst_sr: u32, state: &StreamState) -> Vec<f32> {
    if samples.is_empty() {
        return Vec::new();
    }
    if src_sr == dst_sr {
        if let Some(&last) = samples.last() {
            *state.last_sample.lock() = last;
        }
        return samples.to_vec();
    }

    let step = src_sr as f64 / dst_sr as f64;
    let mut phase = *state.resample_phase.lock();
    let prev = *state.last_sample.lock();

    let estimated = ((samples.len() as f64) / step).ceil() as usize + 1;
    let mut out = Vec::with_capacity(estimated);

    while phase < samples.len() as f64 {
        let idx_floor = phase.floor() as isize;
        let frac = (phase - phase.floor()) as f32;
        let a = if idx_floor < 0 { prev } else { samples[idx_floor as usize] };
        let b_index = (idx_floor + 1) as usize;
        if b_index >= samples.len() {
            out.push(a);
            phase += step;
            break;
        }
        let b = samples[b_index];
        out.push(a + (b - a) * frac);
        phase += step;
    }

    let new_phase = phase - samples.len() as f64;
    *state.resample_phase.lock() = new_phase.max(0.0);
    *state.last_sample.lock() = *samples.last().unwrap_or(&0.0);

    out
}

/// f32 → i16 little-endian byte stream. RMS is returned alongside so the
/// audio-thread level handler can feed the SiriGL waveform shader without a
/// second pass over the samples.
fn quantize_to_i16_le(samples: &[f32]) -> (Vec<u8>, f32) {
    let mut bytes = Vec::with_capacity(samples.len() * 2);
    let mut sum_sq = 0.0f64;
    for &s in samples {
        let clamped = s.clamp(-1.0, 1.0);
        let q = (clamped * 32767.0) as i16;
        bytes.extend_from_slice(&q.to_le_bytes());
        let n = clamped as f64;
        sum_sq += n * n;
    }
    let rms = if samples.is_empty() {
        0.0
    } else {
        (sum_sq / samples.len() as f64).sqrt() as f32
    };
    (bytes, rms)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex as StdMutex;

    #[derive(Default)]
    struct RecordingConsumer {
        chunks: StdMutex<Vec<Vec<u8>>>,
    }

    impl AudioConsumer for RecordingConsumer {
        fn consume_pcm_chunk(&self, pcm: &[u8]) {
            self.chunks.lock().unwrap().push(pcm.to_vec());
        }
    }

    fn decode_i16_le(bytes: &[u8]) -> Vec<i16> {
        bytes
            .chunks_exact(2)
            .map(|chunk| i16::from_le_bytes([chunk[0], chunk[1]]))
            .collect()
    }

    #[test]
    fn downmix_to_mono_averages_complete_interleaved_frames() {
        let mono = downmix_to_mono(&[1.0, -1.0, 0.5, 0.25, 0.0], 2);
        assert_eq!(mono, vec![0.0, 0.375]);
    }

    #[test]
    fn quantize_to_i16_le_clamps_and_reports_rms() {
        let (bytes, rms) = quantize_to_i16_le(&[-2.0, 0.0, 0.5, 2.0]);
        let samples = bytes
            .chunks_exact(2)
            .map(|chunk| i16::from_le_bytes([chunk[0], chunk[1]]))
            .collect::<Vec<_>>();

        assert_eq!(samples, vec![-32767, 0, 16383, 32767]);
        assert!((rms - 0.75).abs() < 0.0001);
    }

    #[test]
    fn resample_passthrough_updates_tail_sample_without_phase_drift() {
        let state = StreamState::new(None);
        *state.resample_phase.lock() = 0.5;

        let out = resample_to_target(
            &[0.1, -0.2, 0.3],
            TARGET_SAMPLE_RATE,
            TARGET_SAMPLE_RATE,
            &state,
        );

        assert_eq!(out, vec![0.1, -0.2, 0.3]);
        assert_eq!(*state.last_sample.lock(), 0.3);
        assert_eq!(*state.resample_phase.lock(), 0.5);
    }

    #[test]
    fn resample_upsamples_with_linear_interpolation_and_tail_state() {
        let state = StreamState::new(None);

        let out = resample_to_target(&[0.0, 1.0], 8_000, TARGET_SAMPLE_RATE, &state);

        assert_eq!(out, vec![0.0, 0.5, 1.0]);
        assert_eq!(*state.last_sample.lock(), 1.0);
        assert_eq!(*state.resample_phase.lock(), 0.0);
    }

    #[test]
    fn process_callback_resamples_non_target_input_before_emitting_pcm() {
        let consumer = RecordingConsumer::default();
        let state = StreamState::new(None);

        process_callback(&[0.0, 1.0], 1, 8_000, &consumer, &state);

        let chunks = consumer.chunks.lock().unwrap();
        assert_eq!(chunks.len(), 1);
        assert_eq!(decode_i16_le(&chunks[0]), vec![0, 16383, 32767]);
        assert_eq!(state.callback_count.load(Ordering::Relaxed), 1);
    }

    #[test]
    fn process_callback_ignores_empty_or_zero_channel_input() {
        let consumer = RecordingConsumer::default();
        let state = StreamState::new(None);

        process_callback(&[], 1, TARGET_SAMPLE_RATE, &consumer, &state);
        process_callback(&[0.25, -0.25], 0, TARGET_SAMPLE_RATE, &consumer, &state);

        assert!(consumer.chunks.lock().unwrap().is_empty());
        assert_eq!(state.callback_count.load(Ordering::Relaxed), 0);
    }

    /// ponytail: the level handler is throttled to ~30 Hz — cpal callbacks run
    /// ~100 Hz and piping every RMS to the IPC bus would flood it. This test
    /// drives `process_callback` many times in tight succession and asserts the
    /// handler fires at most once per `LEVEL_EMIT_INTERVAL_MS` window. The
    /// ceiling is named: if LEVEL_EMIT_INTERVAL_MS shrinks, the count goes up;
    /// if it grows, the count goes down. Upgrade path: per-stream config or
    /// adaptive rate based on shader load — not needed yet.
    #[test]
    fn level_handler_throttles_to_emit_interval() {
        let counter = Arc::new(AtomicU64::new(0));
        let counter_for_cb = Arc::clone(&counter);
        let handler: LevelHandler = Arc::new(move |_level: f32| {
            counter_for_cb.fetch_add(1, Ordering::Relaxed);
        });
        let consumer = RecordingConsumer::default();
        let state = Arc::new(StreamState::new(Some(handler)));

        // 200 callbacks with zero time advance between them: cpal would only
        // emit on the very first call (Instant::now() was set in
        // StreamState::new, and 0 elapsed < LEVEL_EMIT_INTERVAL_MS). Drive
        // `last_level_emit` backward by the interval before each call to
        // simulate time passing; assert exactly one emit per simulated
        // interval window.
        for _ in 0..200 {
            // Force `last_level_emit` into the past so the throttle releases.
            *state.last_level_emit.lock() =
                Instant::now() - std::time::Duration::from_millis(LEVEL_EMIT_INTERVAL_MS + 1);
            process_callback(
                &[0.5, -0.5, 0.25],
                1,
                TARGET_SAMPLE_RATE,
                &consumer,
                &state,
            );
        }

        assert_eq!(counter.load(Ordering::Relaxed), 200);
    }

    /// Throttle WITHOUT time advance = zero emits. Asserts the gate actually
    /// holds — a regression that dropped the throttle would let this test fire
    /// 100 times.
    #[test]
    fn level_handler_blocks_emits_within_interval() {
        let counter = Arc::new(AtomicU64::new(0));
        let counter_for_cb = Arc::clone(&counter);
        let handler: LevelHandler = Arc::new(move |_level: f32| {
            counter_for_cb.fetch_add(1, Ordering::Relaxed);
        });
        let consumer = RecordingConsumer::default();
        let state = Arc::new(StreamState::new(Some(handler)));

        for _ in 0..100 {
            process_callback(
                &[0.5, -0.5, 0.25],
                1,
                TARGET_SAMPLE_RATE,
                &consumer,
                &state,
            );
        }

        // The StreamState::new call seeded `last_level_emit` to "now"; the
        // 100 callbacks all run within microseconds — far under
        // LEVEL_EMIT_INTERVAL_MS (33 ms). Zero emits while inside the window.
        assert_eq!(counter.load(Ordering::Relaxed), 0);
    }
}
