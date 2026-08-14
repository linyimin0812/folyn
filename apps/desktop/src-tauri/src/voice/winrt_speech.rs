//! WinRT Speech 本地 ASR 适配器（Windows）。
//!
//! 把 Windows `Media::SpeechRecognition::SpeechRecognizer` 当作本地 ASR
//! provider。**实时麦克风一次性识别模式**：`voice_start` 时调用
//! `RecognizeAsync()` 启动识别（WinRT 自管 mic capture），返回
//! `IAsyncOperation<SpeechRecognitionResult>` 句柄存入 pending_op；
//! `voice_stop` 时 `.await` 句柄拿转写文本。
//!
//! **为什么不像 macOS 那样 buffer PCM + 批量转写**：windows-rs 0.62 投影
//! 移除了 deprecated `SetAudioDataBuffer` API（Win10 标记弃用，0.6x 投影
//! 不再暴露）。现代替代路径是 `AudioGraph` + 自建 `IRandomAccessStream`，
//! 200+ 行 FFI，对 MVP 过重。`RecognizeAsync()` 实时 mic 是 0.62 投影里
//! 最短的可用路径。
//!
//! **副作用**：
//! - 不再走 cpal mic capture → `voice://mic-level` UI 指示器在 Windows
//!   上不会触发（前端 fallback CSS ring 已在 PRD R15 内）。
//! - `save_source_wav` 在 Windows 返回 None + "不支持保存源音频" 提示
//!   （buffered_pcm 始终空）。
//!
//! **UX 差异**：RecognizeAsync 在用户停止说话后的 silence 阈值触发返回。
//! 多句连续说话只识别第一句；后续短语丢失。升级路径：ContinuousRecognitionSession
//! + ResultGenerated 事件累积，但需要 TypedEventHandler FFI（后续 PR）。
//!
//! 权限：WinRT `SpeechRecognizer` 在首次 `Create` 时触发系统麦克风
//! Consent UI。无独立"语音识别"权限概念，无 Accessibility 等价概念。
//!
//! 离线：WinRT SpeechRecognizer 默认走云识别（Microsoft 在线 SR）。
//! 离线需用户在「设置 → 时间和语言 → 语言和区域 → 添加语言」勾选"语音
//! 识别"子功能。`SupportedTopicLanguages` 探测，缺失即清晰失败引导。
//!
//! 非 Windows 平台不编译本模块（`#![cfg(target_os = "windows")]` 顶层门控）。
//! 端口自 macOS `apple_speech.rs`（同 trait `AudioConsumer`、同 `RawTranscript`
//! 形状），对齐 `voice.rs::voice_stop` 调用契约。

#![cfg(target_os = "windows")]

use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use anyhow::{anyhow, bail, Context, Result};
use parking_lot::Mutex;
use windows::core::HSTRING;
use windows::Globalization::Language;
use windows::Media::SpeechRecognition::{
    SpeechRecognizer, SpeechRecognitionResult, SpeechRecognitionScenario,
    SpeechRecognitionTopicConstraint,
};

/// Type-erased pending recognition op. windows-rs 0.62 `IAsyncOperation<T>`
/// impls `Future<Output = Result<T, windows::core::Error>>` when `T: Send`,
/// but the exact path/import is gated by feature flags that don't reliably
/// expose `IAsyncOperation` by name across 0.6x point releases. Boxing erases
/// the concrete type so we don't need to name it.
type PendingOp = Pin<Box<dyn Future<Output = Result<SpeechRecognitionResult>> + Send>>;

/// ASR 一次会话产出的转写结果。镜像 macOS `apple_speech::RawTranscript`，
/// `voice.rs::voice_stop` 通过 `.text` 字段取转写文本。`duration_ms` 仅用于
/// 日志，未 surface 给前端（与 macOS 实现一致）。
#[derive(Debug, Clone, Default)]
pub struct RawTranscript {
    pub text: String,
    #[allow(dead_code)]
    pub duration_ms: u64,
}

/// Windows WinRT Speech ASR 适配器。
///
/// **生命周期**：
/// - `new(locale)`: idle 状态。
/// - `start_session()`: 创建 SpeechRecognizer + 编译约束 + 启动
///   `RecognizeAsync()` 异步 op，存入 `pending_op`。
/// - `transcribe()`: `.await` pending_op 拿结果文本，清空 pending_op。
/// - `cancel()`: `.Cancel()` pending_op 并清空。
///
/// STA 线程亲和性：windows-rs 0.62 `IAsyncOperation<T>` 是 Send-safe Future
/// （T: Send 时），可在 tokio multi-thread runtime 上直接 await，无需
/// spawn_blocking。
pub struct WinRtSpeechAsr {
    locale: Option<String>,
    /// voice_start 创建、voice_stop/cancel 释放。Option<> 守 pending 状态。
    /// ponytail: 用 `Mutex<Option<...>>` 而非 atomic，因 `PendingOp` 是
    /// boxed Future，无原子 swap；短临界区（仅 take/set）开销可接受。
    pending_op: Mutex<Option<PendingOp>>,
    /// 在 start_session 创建 RecognizeAsync 时持有 recognizer，确保
    /// async op 期间源对象不被 GC。voice_stop/cancel 时释放。
    recognizer: Mutex<Option<SpeechRecognizer>>,
    cancel_flag: Arc<AtomicBool>,
}

impl WinRtSpeechAsr {
    pub fn new(locale: Option<String>) -> Self {
        Self {
            locale,
            pending_op: Mutex::new(None),
            recognizer: Mutex::new(None),
            cancel_flag: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn buffer_duration_ms(&self) -> u64 {
        // Windows 走 WinRT 实时 mic，不走 cpal buffer。始终 0。
        0
    }

    /// True if a recognition session is active (pending_op set, not yet
    /// transcribed/cancelled). Used by `VoiceInner::is_recording` on Windows.
    pub fn is_session_active(&self) -> bool {
        self.pending_op.lock().is_some()
    }

    /// Windows 上无 PCM buffer（WinRT 自管 mic capture）。返回空 Vec 让
    /// `voice_stop` 的 save_source_wav 路径走 "不支持" 分支。
    pub fn buffered_pcm(&self) -> Vec<u8> {
        Vec::new()
    }

    /// voice_start 调用：创建 recognizer + 编译 dictation 约束 + 启动
    /// `RecognizeAsync()` 并存句柄。返回后立刻开始 mic capture。
    pub async fn start_session(&self) -> Result<()> {
        // 复位取消标志。
        self.cancel_flag.store(false, Ordering::SeqCst);

        let lang_tag = HSTRING::from(self.locale.as_deref().unwrap_or("en-US"));
        let lang = Language::CreateLanguage(&lang_tag)
            .context("WinRT Language::CreateLanguage failed (检查语言包安装)")?;

        // ponytail: SupportedTopicLanguages 预飞检查。IVectorView 非 Send，
        // 必须在 await 前 drop — 否则跨 await 持有破坏 voice_start future 的
        // Send 要求。scope 限制 + check 后 Size() 取回 bool，让 supported 立即释放。
        {
            let supported = SpeechRecognizer::SupportedTopicLanguages()?;
            if supported.Size()? == 0 {
                bail!(
                    "WinRT 语音识别不可用：未安装任何语言包。请在「设置 → 时间和语言 → \
                     语言和区域 → 添加语言」勾选「语音识别」子功能（语言：{}）",
                    self.locale.as_deref().unwrap_or("en-US")
                );
            }
        }

        // ponytail: windows-rs 0.62 `SpeechRecognizer::Create` 是同步构造
        // （不再走 IAsyncOperation 包装），直接返回 Result。
        let recognizer = SpeechRecognizer::Create(&lang)
            .context("WinRT SpeechRecognizer::Create failed")?;

        let dictation = SpeechRecognitionTopicConstraint::Create(
            SpeechRecognitionScenario::Dictation,
            &HSTRING::from(""),
        )?;
        recognizer.Constraints()?.Append(&dictation)?;
        recognizer
            .CompileConstraintsAsync()?
            .await
            .context("WinRT CompileConstraintsAsync failed (语言包可能未安装)")?;

        if self.cancel_flag.load(Ordering::SeqCst) {
            return Ok(());
        }

        // 启动 mic capture。RecognizeAsync 立即返回 op 句柄，op 在后台捕获
        // 并在用户停止说话 + silence 阈值后完成。
        let op = recognizer.RecognizeAsync()?;
        // ponytail: Box::pin 擦掉 IAsyncOperation 具体类型，避免依赖
        // windows-rs 0.6x 不稳定的 feature 投影。op.await 返回
        // Result<SpeechRecognitionResult, windows::core::Error>，转 anyhow。
        let boxed: PendingOp = Box::pin(async move {
            op.await.map_err(|e| anyhow!("{e}"))
        });
        *self.pending_op.lock() = Some(boxed);
        *self.recognizer.lock() = Some(recognizer);
        Ok(())
    }

    /// voice_stop 调用：await pending_op 拿 SpeechRecognitionResult，取 Text。
    /// 成功后清空 pending_op + recognizer（释放 COM 引用）。
    pub async fn transcribe(&self) -> Result<RawTranscript> {
        let op = self.pending_op.lock().take();
        let Some(op) = op else {
            return Ok(RawTranscript::default());
        };
        // ponytail: 不 spawn_blocking — PendingOp 是 Send-safe boxed Future
        // （IAsyncOperation<SpeechRecognitionResult> Send + Future），可直接
        // tokio worker await（research 风险点 3）。
        let result = op
            .await
            .context("WinRT RecognizeAsync failed (语言包未安装 / 麦克风被拒 / silence 超时)")?;
        // recognizer 在 op 完成后释放，避免 COM 对象泄漏。
        drop(self.recognizer.lock().take());
        let text: HSTRING = result.Text()?;
        Ok(RawTranscript {
            text: text.to_string(),
            duration_ms: 0,
        })
    }

    pub fn cancel(&self) {
        self.cancel_flag.store(true, Ordering::SeqCst);
        // ponytail: 仅 drop pending_op + recognizer。不显式调 `op.Cancel()`
        // — windows-rs 0.62 投影的 IAsyncOperation 上 Cancel() 方法签名
        // 需 Windows host 验证；drop 已让句柄失效，op 后台自行完成或超时
        // 释放。资源上略泄漏（识别继续到 silence 阈值），用户视角已取消。
        // 升级路径：验证 IAsyncInfo::Cancel() 投影后改显式取消。
        drop(self.pending_op.lock().take());
        drop(self.recognizer.lock().take());
    }
}

impl Default for WinRtSpeechAsr {
    fn default() -> Self {
        Self::new(None)
    }
}

// ponytail: 无 self-check 测试 — windows-only 模块 macOS host 无法编译其测试。
// Windows host 验证：手动 `pnpm tauri dev` 录音 → stop 看转写结果。
// 升级路径：加 mock recognizer 的 round-trip 测试若 windows-rs 提供 test-only API。
