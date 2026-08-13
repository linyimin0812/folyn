//! WinRT Speech 本地 ASR 适配器（Windows）。
//!
//! 把 Windows `Media::SpeechRecognition::SpeechRecognizer` 当作本地 ASR
//! provider：实现 `super::recorder::AudioConsumer` 把 PCM 累进缓冲，
//! `transcribe()` 返回 `RawTranscript{text, duration_ms}`。
//!
//! **首版批处理**：把缓冲的 16k/mono/16-bit PCM 用 `encode_wav_16k_mono`
//! 写成临时 wav，喂给 SpeechRecognizer (via `SetAudioDataBuffer` +
//! `RecognizeAsync`)。避开实时流式 partial，换取实现确定性。
//!
//! 权限：WinRT `SpeechRecognizer` 在首次 `CreateAsync` 时触发系统麦克风
//! Consent UI（cpal WASAPI 也会触发，但 WinRT 创建早于 cpal 的 stream
//! build）。无独立"语音识别"权限概念，无 Accessibility 等价概念。
//!
//! 离线：WinRT SpeechRecognizer 默认走云识别（Microsoft 在线 SR）。
//! 离线需用户在「设置 → 时间和语言 → 语言和区域 → 添加语言」勾选"语音
//! 识别"子功能。`SupportedTopicLanguages` 探测，缺失即清晰失败引导。
//!
//! 非 Windows 平台不编译本模块（`#![cfg(target_os = "windows")]` 顶层门控）。
//! 端口自 macOS `apple_speech.rs`（同 trait `AudioConsumer`、同 `RawTranscript`
//! 形状），对齐 `voice.rs::voice_stop` 调用契约。

#![cfg(target_os = "windows")]

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use anyhow::{bail, Context, Result};
use parking_lot::Mutex;
use windows::core::HSTRING;
use windows::Globalization::Language;
use windows::Media::SpeechRecognition::{
    SpeechRecognizer, SpeechRecognitionTopicConstraint, SpeechRecognitionScenario,
};
use windows::Storage::Streams::{DataWriter, InMemoryRandomAccessStream};

use super::wav::encode_wav_16k_mono;

/// ASR 一次会话产出的转写结果。镜像 macOS `apple_speech::RawTranscript`，
/// `voice.rs::voice_stop` 通过 `.text` 字段取转写文本。`duration_ms` 仅用于
/// 日志，未 surface 给前端（与 macOS 实现一致）。
#[derive(Debug, Clone)]
pub struct RawTranscript {
    pub text: String,
    #[allow(dead_code)]
    pub duration_ms: u64,
}

/// Windows WinRT Speech ASR 消费者。镜像 macOS `AppleSpeechAsr` 接口：
/// `new(locale) / buffer_duration_ms / buffered_pcm / transcribe / cancel +
/// impl AudioConsumer`。
///
/// STA 线程亲和性：`SpeechRecognizer` 创建/await 在 async command (`voice_stop`)
/// 里直接 `.await`，不 `spawn_blocking`（windows-rs 3.x 的 `IAsyncOperation`
/// Future `Send` 友好，可在 tokio multi-thread runtime 上 await）。
pub struct WinRtSpeechAsr {
    /// 16-bit LE PCM 字节缓冲（recorder 推什么我们存什么）。
    buffer: Mutex<Vec<u8>>,
    /// 识别 locale（"zh-CN" / "en-US"）。None = 系统默认。
    locale: Option<String>,
    /// 取消标志。`cancel()` 置位；`transcribe()` 在每个 await 点前后检查。
    cancel_flag: Arc<AtomicBool>,
}

impl WinRtSpeechAsr {
    pub fn new(locale: Option<String>) -> Self {
        Self {
            buffer: Mutex::new(Vec::new()),
            locale,
            cancel_flag: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn buffer_duration_ms(&self) -> u64 {
        (self.buffer.lock().len() as u64 / 2) * 1000 / 16_000
    }

    /// Clone of the buffered PCM (16 kHz / mono / Int16-LE bytes). Source-file
    /// save grabs this BEFORE `transcribe()` (which clears the buffer on
    /// success). Mirrors macOS `AppleSpeechAsr::buffered_pcm`.
    pub fn buffered_pcm(&self) -> Vec<u8> {
        self.buffer.lock().clone()
    }

    /// stop 时调用：编码 PCM 成 WAV，喂给 `SpeechRecognizer` 识别。
    ///
    /// 失败时**保留** buffer（与 macOS `AppleSpeechAsr::transcribe` 一致），
    /// 成功才清缓冲。
    pub async fn transcribe(&self) -> Result<RawTranscript> {
        let pcm = self.buffer.lock().clone();
        if pcm.is_empty() {
            return Ok(RawTranscript {
                text: String::new(),
                duration_ms: 0,
            });
        }
        let duration_ms = (pcm.len() as u64 / 2) * 1000 / 16_000;
        let locale = self.locale.clone();

        // 复位取消标志：上一会话若以取消收尾，标志可能仍为 true。
        self.cancel_flag.store(false, Ordering::SeqCst);
        let cancel_flag = Arc::clone(&self.cancel_flag);

        // ponytail: 不 `spawn_blocking` — windows-rs 3.x 的 IAsyncOperation 是
        // Send-safe Future，可直接在 tauri async command 的 tokio worker 上 await。
        // `spawn_blocking` 会把 WinRT 对象 throw 到阻塞线程池，破坏 STA 亲和性
        // （research summary 风险点 3）。
        let result = transcribe_pcm_async(&pcm, duration_ms, locale.as_deref(), &cancel_flag).await;

        if result.is_ok() {
            self.buffer.lock().clear();
        }
        result
    }

    pub fn cancel(&self) {
        // WinRT dictation `RecognizeAsync` 不可中途取消（一次性返回完整文本），
        // cancel = 置标志，下次 transcribe 检查时丢弃结果。无在飞 task 句柄。
        self.cancel_flag.store(true, Ordering::SeqCst);
        self.buffer.lock().clear();
    }
}

impl Default for WinRtSpeechAsr {
    fn default() -> Self {
        Self::new(None)
    }
}

impl super::recorder::AudioConsumer for WinRtSpeechAsr {
    fn consume_pcm_chunk(&self, pcm: &[u8]) {
        self.buffer.lock().extend_from_slice(pcm);
    }
}

/// WinRT 批处理识别入口。windows-rs 把 IAsyncOperation 实现成 Future，直接 await。
///
/// ponytail: API 形状（`SpeechRecognizer::CreateAsync(&Language)?.await?` 等）来自
/// windows-rs 3.x 投影惯例（research doc winrt-speech.md §API 调用模式）。具体签名
/// 需 Windows host `cargo check` 验证；macOS host 无法编译此模块。
async fn transcribe_pcm_async(
    pcm: &[u8],
    duration_ms: u64,
    locale: Option<&str>,
    cancel_flag: &AtomicBool,
) -> Result<RawTranscript> {
    if cancel_flag.load(Ordering::SeqCst) {
        return Ok(RawTranscript {
            text: String::new(),
            duration_ms,
        });
    }

    // 编码 PCM → WAV 字节流。
    let samples: Vec<i16> = pcm
        .chunks_exact(2)
        .map(|c| i16::from_le_bytes([c[0], c[1]]))
        .collect();
    let wav_bytes = encode_wav_16k_mono(&samples);

    // 创建 SpeechRecognizer + 加载 dictation constraint。
    let lang_tag = HSTRING::from(locale.unwrap_or("en-US"));
    let lang = Language::CreateLanguage(&lang_tag)
        .context("WinRT Language::CreateLanguage failed (检查语言包安装)")?;

    // ponytail: SupportedTopicLanguages 预飞检查（research summary 风险点 4）。
    // 缺离线语言包时 CreateAsync 后续 CompileConstraintsAsync 会报错，提前给清晰提示。
    let supported = SpeechRecognizer::SupportedTopicLanguages()?;
    let supported_count = supported.Size()?;
    if supported_count == 0 {
        bail!(
            "WinRT 语音识别不可用：未安装任何语言包。请在「设置 → 时间和语言 → \
             语言和区域 → 添加语言」勾选「语音识别」子功能（语言：{}）",
            locale.unwrap_or("en-US")
        );
    }

    // ponytail: windows-rs 0.62 `SpeechRecognizer::Create` is a sync constructor
    // returning `Result<SpeechRecognizer>` (not IAsyncOperation — the projection
    // flattened the async factory in 0.6x). No `.await` needed.
    let recognizer = SpeechRecognizer::Create(&lang)
        .context("WinRT SpeechRecognizer::Create failed")?;

    // 加 dictation 约束（自由文本听写，对齐 macOS SFSpeechURLRecognitionRequest 的
    // 自由文本语义）。`SpeechRecognitionTopicConstraint::Create(scenario, &HSTRING)`
    // + Scenario::Dictation 启用 WebService grammar 的听写模式。
    let dictation = SpeechRecognitionTopicConstraint::Create(
        SpeechRecognitionScenario::Dictation,
        &HSTRING::from(""),
    )?;
    recognizer.Constraints()?.Append(&dictation)?;
    recognizer
        .CompileConstraintsAsync()?
        .await
        .context("WinRT CompileConstraintsAsync failed (语言包可能未安装)")?;

    if cancel_flag.load(Ordering::SeqCst) {
        return Ok(RawTranscript {
            text: String::new(),
            duration_ms,
        });
    }

    // 把 WAV 字节写入 InMemoryRandomAccessStream，喂给 recognizer 的
    // SetAudioDataBuffer。这是 WinRT 喂预录音频给 SpeechRecognizer 的标准路径
    // （SetAudioDataBuffer 在 Win10 标记 deprecated 但 Win11 仍可用）。
    let stream = InMemoryRandomAccessStream::new()?;
    let writer = DataWriter::CreateDataWriter(&stream)?;
    writer.WriteBytes(&wav_bytes)?;
    writer.StoreAsync()?.await?;
    // 重置 stream 读指针到 0，recognizer 从头读。
    let _ = stream.Seek(0)?;
    recognizer.SetAudioDataBuffer(&stream)?;

    let result_op = recognizer.RecognizeAsync()?;
    // 在 await 前检查 cancel_flag，让 cancel 能在识别开始前短路。
    if cancel_flag.load(Ordering::SeqCst) {
        let _ = result_op.Cancel();
        return Ok(RawTranscript {
            text: String::new(),
            duration_ms,
        });
    }
    // ponytail: windows-rs 3.x 把 IAsyncOperation<SpeechRecognitionResult>
    // 实现为 Future<Output = Result<SpeechRecognitionResult, Error>>，直接 await。
    // 不 spawn_blocking（STA 亲和性，research 风险点 3）。
    let result = result_op
        .await
        .context("WinRT RecognizeAsync failed (语言包可能未安装 / 麦克风被拒)")?;
    let text: HSTRING = result.Text()?;
    Ok(RawTranscript {
        text: text.to_string(),
        duration_ms,
    })
}

// ponytail: 无 self-check 测试 — windows-only 模块 macOS host 无法编译其测试。
// Windows host 验证：手动 `pnpm tauri dev` 录音 → stop 看转写结果。
// 升级路径：加 mock recognizer 的 round-trip 测试若 windows-rs 提供 test-only API。
