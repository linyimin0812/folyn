//! Apple Speech 本地 ASR 适配器（macOS）。
//!
//! 把 Apple 的 `SFSpeechRecognizer` 当作本地 ASR provider：实现
//! `super::recorder::AudioConsumer` 把 PCM 累进缓冲，`transcribe()` 返回
//! `RawTranscript{text, duration_ms}`。
//!
//! **首版批处理**：把缓冲的 16k/mono/16-bit PCM 用 `encode_wav_16k_mono`
//! 写成临时 wav，喂给 `SFSpeechURLRecognitionRequest`。这样避开
//! `AVAudioPCMBuffer` / `AVAudioFormat` 的 objc2 桥接，换取实现确定性。
//! 实时 partial 流式列为后续增量，不在本次范围。
//!
//! 权限走 `SFSpeechRecognizer.requestAuthorization:`（completion handler
//! block）。未授权时 `transcribe()` 返回清晰错误。
//!
//! 非 macOS 平台不编译本模块（`#![cfg(target_os = "macos")]` 顶层门控）。
//! 端口自 openless `asr/local/apple_speech_provider.rs`，最小子集 —
//! PR2 仅需「记录 → 停止 → 转写」链路，权限/累积/多话段逻辑保持原样
//! 因为这些是 openless 战斗测试过的高价值回归守卫（见各子模块测试组）。
//!
//! 子模块组织：`recognize`（批处理识别 FFI 主体）、`lifecycle`（回调/等待循环
//! 共享状态与终止判定）、`segment`（多话段累积）、`cjk`（话段拼接纯函数）、
//! `objc`（objc2 低层桥接辅助）。

#![cfg(target_os = "macos")]

mod cjk;
mod lifecycle;
mod objc;
mod recognize;
mod segment;

pub use self::recognize::ensure_authorized;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use anyhow::{Context, Result};
use objc2::runtime::AnyObject;
use objc2::msg_send;
use parking_lot::Mutex;

use self::recognize::transcribe_pcm_blocking;

/// ASR 一次会话产出的转写结果。`duration_ms` 是被转写音频的时长，便于上层
/// 动态超时计算。端口自 openless `asr::RawTranscript`，本模块自洽定义不引入
/// 跨模块类型。
#[derive(Debug, Clone)]
pub struct RawTranscript {
    pub text: String,
    /// PR2 doesn't surface duration to the frontend (only `text` is returned
    /// from `voice_stop`); kept for the openless-port test assertions and for
    /// PR3/PR4 which may use it for dynamic timeouts / telemetry.
    #[allow(dead_code)]
    pub duration_ms: u64,
}

/// `SFSpeechRecognitionTask` 的裸指针包装，仅为把 task 句柄从 spawn_blocking 线程
/// 存进 `AppleSpeechAsr::active_task`，供任意线程（含 tokio 上取消的线程）调用
/// `-[SFSpeechRecognitionTask cancel]` 终止识别。
///
/// SAFETY: `SFSpeechRecognitionTask` 是标准的 objc/ARC 对象，其 `cancel` 属于
/// Speech.framework 文档承诺可从任意线程安全调用的操作（内部转派到自身队列）；
/// 我们对该指针只做两件事——存入 `active_task`、以及调用 `cancel`——不做解引用、
/// 不改内部状态。指针仅在对应识别请求存活期间被持有：`recognize_file` 返回前会把
/// `active_task` 置回 `None`，此时 recognizer / request 仍在同一栈帧强引用存活，
/// task 不会被提前释放。因此跨线程传递该裸指针并调用 `cancel` 不违反内存/线程安全。
/// 不实现 `Sync`——它只在 `Mutex` 保护下被取出后使用，无需并发共享引用。
struct SendableTask(*mut AnyObject);

// SAFETY: 见 `SendableTask` 文档注释——底层 SFSpeechRecognitionTask 线程安全，
// `cancel` 可跨线程调用，包装体只承载指针用于「存」与「取消」。
unsafe impl Send for SendableTask {}

pub struct AppleSpeechAsr {
    /// 16-bit LE PCM 字节缓冲（recorder 推什么我们存什么）。与 LocalQwenAsr 同形。
    buffer: Mutex<Vec<u8>>,
    /// 识别 locale（Apple 标识符，如 "zh-CN"）。None = 用系统默认。由用户工作语言映射
    /// 而来 —— SFSpeechRecognizer 一个实例只认一种语言，不显式指定就落到系统首选语言
    /// （常是英文），中文语音会被英文引擎识别成英文且理解错误（用户报告的根因）。
    locale: Option<String>,
    /// 取消标志。`cancel()` 置位；`recognize_file` 的等待轮询每轮检查，置位即放弃
    /// 等待并真正 `cancel` 底层识别任务 —— 让被上层动态超时抛弃 / 被 `cancel()` 的
    /// spawn_blocking 阻塞线程在 ~100ms 内退出，而不是傻等满 `RECOGNITION_WAIT`。
    cancel_flag: Arc<AtomicBool>,
    /// 当前在飞的识别任务句柄。`recognize_file` 拿到 task 即存入，返回前清空；
    /// `cancel()` 从这里取出并调用 `-[SFSpeechRecognitionTask cancel]` 终止识别。
    active_task: Arc<Mutex<Option<SendableTask>>>,
}

impl AppleSpeechAsr {
    pub fn new(locale: Option<String>) -> Self {
        Self {
            buffer: Mutex::new(Vec::new()),
            locale,
            cancel_flag: Arc::new(AtomicBool::new(false)),
            active_task: Arc::new(Mutex::new(None)),
        }
    }

    /// 当前缓冲音频时长（毫秒）。与 LocalQwenAsr::buffer_duration_ms 对齐，
    /// coordinator 用它给本地 provider 计算动态超时。不消费缓冲。
    pub fn buffer_duration_ms(&self) -> u64 {
        (self.buffer.lock().len() as u64 / 2) * 1000 / 16_000
    }

    /// Clone of the buffered PCM (16 kHz / mono / Int16-LE bytes). PR3 source-
    /// file save grabs this BEFORE `transcribe()` (which clears the buffer on
    /// success) so the WAV writer sees the full session audio even when
    /// transcription succeeds. Does not consume the buffer.
    pub fn buffered_pcm(&self) -> Vec<u8> {
        self.buffer.lock().clone()
    }

    /// stop 时调用：把缓冲编码成临时 wav，喂给 `SFSpeechURLRecognitionRequest`，
    /// 把异步结果同步化后返回。
    ///
    /// 失败时**保留** buffer（与 WhisperBatchASR / LocalQwenAsr 一致）：凭据无关，
    /// 但权限被拒 / 识别失败时不该把用户录音直接丢掉。仅成功路径清缓冲。
    pub async fn transcribe(&self) -> Result<RawTranscript> {
        // clone 而非 take：会话末调用一次，几 MB 可接受；失败时缓冲仍在。
        let pcm = self.buffer.lock().clone();
        if pcm.is_empty() {
            return Ok(RawTranscript {
                text: String::new(),
                duration_ms: 0,
            });
        }
        let duration_ms = (pcm.len() as u64 / 2) * 1000 / 16_000;
        let locale = self.locale.clone();

        // 本次识别开始前复位取消标志：上一会话若以取消收尾，标志可能仍为 true。
        self.cancel_flag.store(false, Ordering::SeqCst);
        let cancel_flag = Arc::clone(&self.cancel_flag);
        let active_task = Arc::clone(&self.active_task);

        // SFSpeechRecognizer 是阻塞且基于 objc runloop 的同步桥接；放到
        // spawn_blocking 不占 tokio runtime。与 LocalQwenAsr 走同一个 Tauri
        // 持有的 runtime handle。
        let result = tauri::async_runtime::spawn_blocking(move || {
            transcribe_pcm_blocking(
                &pcm,
                duration_ms,
                locale.as_deref(),
                &cancel_flag,
                &active_task,
            )
        })
        .await
        .context("apple-speech transcribe spawn_blocking join 失败")?;

        if result.is_ok() {
            self.buffer.lock().clear();
        }
        result
    }

    pub fn cancel(&self) {
        // 先置位取消标志：等待轮询下一轮（~100ms 内）看到即放弃等待并退出阻塞线程。
        self.cancel_flag.store(true, Ordering::SeqCst);
        // 再真正终止在飞的识别任务（若有）。取出句柄后立即调用 cancel。
        if let Some(task) = self.active_task.lock().take() {
            // SAFETY: `task.0` 是 `recognitionTaskWithRequest:` 返回的
            // SFSpeechRecognitionTask 指针。`-[SFSpeechRecognitionTask cancel]` 无参、
            // 无返回值，是 Speech.framework 承诺可从任意线程调用的操作。此处仅调用
            // cancel、不解引用指针；调用后不再使用该句柄（已 take 出 Option）。
            let _: () = unsafe { msg_send![task.0, cancel] };
            log::info!("[apple-speech] recognition task cancelled");
        }
        self.buffer.lock().clear();
    }
}

impl Default for AppleSpeechAsr {
    fn default() -> Self {
        Self::new(None)
    }
}

impl super::recorder::AudioConsumer for AppleSpeechAsr {
    fn consume_pcm_chunk(&self, pcm: &[u8]) {
        self.buffer.lock().extend_from_slice(pcm);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    // `super` from inside `tests` is `apple_speech`; the recorder trait is a
    // sibling module under `voice`, so go up one more level.
    use super::super::recorder::AudioConsumer;

    #[test]
    fn buffer_duration_tracks_consumed_pcm() {
        let asr = AppleSpeechAsr::new(None);
        assert_eq!(asr.buffer_duration_ms(), 0);
        // 16k * 2 bytes/sample * 1s = 32000 bytes。
        asr.consume_pcm_chunk(&vec![0u8; 32_000]);
        assert_eq!(asr.buffer_duration_ms(), 1_000);
        asr.consume_pcm_chunk(&vec![0u8; 16_000]);
        assert_eq!(asr.buffer_duration_ms(), 1_500);
    }

    #[test]
    fn cancel_clears_buffer() {
        let asr = AppleSpeechAsr::new(None);
        asr.consume_pcm_chunk(&vec![0u8; 32_000]);
        asr.cancel();
        assert_eq!(asr.buffer_duration_ms(), 0);
    }

    #[tokio::test]
    async fn transcribe_empty_buffer_returns_empty() {
        let asr = AppleSpeechAsr::new(None);
        let transcript = asr.transcribe().await.unwrap();
        assert_eq!(transcript.text, "");
        assert_eq!(transcript.duration_ms, 0);
    }

    #[test]
    fn cancel_flag_defaults_false_and_set_by_cancel() {
        let asr = AppleSpeechAsr::new(None);
        assert!(
            !asr.cancel_flag.load(Ordering::SeqCst),
            "取消标志初值应为 false"
        );
        asr.cancel();
        assert!(
            asr.cancel_flag.load(Ordering::SeqCst),
            "cancel() 应把取消标志置位，让等待轮询下一轮退出"
        );
    }

    #[test]
    fn active_task_defaults_none() {
        let asr = AppleSpeechAsr::new(None);
        assert!(
            asr.active_task.lock().is_none(),
            "尚未发起识别时 active_task 应为 None"
        );
    }

    #[test]
    fn cancel_on_empty_active_task_is_noop_and_sets_flag() {
        // active_task 为 None 时 cancel() 不应发起任何 objc 调用，只置标志 + 清缓冲。
        let asr = AppleSpeechAsr::new(None);
        assert!(asr.active_task.lock().is_none());
        asr.cancel(); // 不得 panic
        assert!(asr.cancel_flag.load(Ordering::SeqCst));
        assert!(asr.active_task.lock().is_none());
    }

    #[tokio::test]
    async fn transcribe_empty_buffer_short_circuits_before_flag_reset() {
        // 空缓冲在复位取消标志之前就提前 return，因此不进入识别逻辑，flag 维持原值。
        // 这条固定住短路顺序：只有真正要识别（缓冲非空）时才会复位并进入轮询。
        let asr = AppleSpeechAsr::new(None);
        asr.cancel_flag.store(true, Ordering::SeqCst);
        let out = asr.transcribe().await.unwrap();
        assert_eq!(out.text, "");
        assert!(asr.cancel_flag.load(Ordering::SeqCst));
    }

    #[test]
    fn sendable_task_is_send() {
        // 编译期断言：SendableTask 必须是 Send，才能被 spawn_blocking 捕获跨线程存取。
        fn assert_send<T: Send>() {}
        assert_send::<SendableTask>();
        assert_send::<Arc<Mutex<Option<SendableTask>>>>();
    }
}
