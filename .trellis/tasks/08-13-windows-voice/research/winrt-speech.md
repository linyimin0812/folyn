# Research: WinRT SpeechRecognition in Rust (windows crate)

- **Query**: WinRT `Media::SpeechRecognition::SpeechRecognizer` 成熟度、API 稳定性、Rust `await` 模式、语言包/离线、与 macOS `apple_speech` 接口对齐
- **Scope**: mixed (内部代码已读 + 外部 crate 文档知识)
- **Date**: 2026-08-13

## TL;DR

`windows` crate（microsoft/windows-rs）的 `Media_SpeechRecognition` feature **成熟可用**，1.x 稳定 API。`SpeechRecognizer` 创建走 `SpeechRecognizer::CreateAsync(&Language)` → `IAsyncOperation<SpeechRecognizer>` → `.await?`。结果类型 `IAsyncOperation<SpeechRecognitionResult>`，`.await` 拿到 `SpeechRecognitionResult`，`.Text(&self)` 取 `HString`。Rust 侧用 `windows::core::HString`，无需 objc2 FFI。离线需用户预装对应语言的 "Speech Recognizer" 语言包（设置 → 时间和语言 → 语言 → 添加语言 → 勾选"语音"）。`Media_Capture` feature 用于麦克风权限，但 cpal 已隐式触发首次麦克风许可，**MediaCapture 不必引入**（见 cpal-windows.md）。

## Files Found

| File Path | Description |
|---|---|
| `apps/desktop/src-tauri/src/voice.rs:67-76` | macOS 子模块 `mod` 声明，`#[cfg(target_os = "macos")]` gate；Windows 实现需新增 `#[cfg(target_os = "windows")] mod winrt_speech;` |
| `apps/desktop/src-tauri/src/voice/apple_speech.rs` | macOS `AppleSpeechAsr` 接口形状（`new(locale) / consume_pcm_chunk / buffer_duration_ms / buffered_pcm / transcribe() -> Future<RawTranscript> / cancel()`），Windows 需对齐 |
| `apps/desktop/src-tauri/src/voice/recorder.rs:39-43` | `AudioConsumer` trait — Windows 实现必须 `impl AudioConsumer` 喂 PCM |
| `apps/desktop/src-tauri/src/voice.rs:176-285` | `voice_start` macOS 实现入口；Windows 等价走 `winrt_speech::WinRtSpeechAsr` + `recorder::Recorder`（cpal 跨平台，cfg-gate 改放宽） |
| `apps/desktop/src-tauri/src/voice.rs:431-516` | `voice_stop` → `asr.transcribe().await`，Windows 复用此形态 |
| `apps/desktop/src-tauri/src/voice/apple_speech.rs:200-204` | `impl AudioConsumer for AppleSpeechAsr`，Windows 同 trait |

## macOS `apple_speech` 接口形状（对齐点）

```rust
// apple_speech.rs:95-204
pub struct AppleSpeechAsr {
    buffer: Mutex<Vec<u8>>,          // 16-bit LE PCM 字节流
    locale: Option<String>,          // "zh-CN" / "en-US" / ...
    cancel_flag: Arc<AtomicBool>,
    active_task: Arc<Mutex<Option<SendableTask>>>,
}
impl AppleSpeechAsr {
    pub fn new(locale: Option<String>) -> Self;
    pub fn buffer_duration_ms(&self) -> u64;
    pub fn buffered_pcm(&self) -> Vec<u8>;
    pub async fn transcribe(&self) -> Result<RawTranscript>;  // 清空 buffer on Ok
    pub fn cancel(&self);
}
impl super::recorder::AudioConsumer for AppleSpeechAsr {
    fn consume_pcm_chunk(&self, pcm: &[u8]);  // 累进 buffer
}
```

Windows 等价结构（**推荐模块名 `winrt_speech`**，文件 `apps/desktop/src-tauri/src/voice/winrt_speech.rs`，顶层 `#![cfg(target_os = "windows")]`）：

```rust
pub struct WinRtSpeechAsr {
    buffer: Mutex<Vec<u8>>,
    locale: Option<String>,
    cancel_flag: Arc<AtomicBool>,
    active_task: Arc<Mutex<Option<CancelGuard>>>,
}
// 同 trait impl，transcribe() 把 PCM 写临时 wav → SpeechRecognitionResult
```

## windows crate API 调用模式

**Cargo.toml feature 列表**（最小集，进 summary.md）：

```toml
[target.'cfg(target_os = "windows")'.dependencies]
windows = { version = "3", features = [
  "Media_SpeechRecognition",
  "Media_Capture",                    # 仅当显式 MediaCapture 权限流才需要；cpal 隐式触发可省
  "Globalization",                    # Language / Windows.Globalization.Language
  "Foundation",                       # IAsyncOperation / HString / await 基础
  "Storage",                          # StorageFile::GetFileFromPathAsync（喂 wav 给 recognizer）
  "Data_Xml_Dom",                     # 可选，不做 SSML 时省略
] }
```

> **版本**：当前 `windows` crate 稳定线 3.x（microsoft/windows-rs 0.x→1.x→2.x→3.x）。`apps/desktop/src-tauri/Cargo.toml:142` 已用 `windows-sys` 0.59（DPAPI），但 `windows-sys` 是 raw 指针 FFI，**不含 WinRT 投影**。WinRT 必须 `windows` 而非 `windows-sys`，两者可共存于同一 `Cargo.toml`（不同 feature 集合），但 `windows` 与 `windows-sys` 同时在 Windows 目标上拉一次会膨胀编译时间，**建议把 DPAPI 的 `windows-sys` 改为统一用 `windows`**（feature `Win32_Security_Cryptography` + `Win32_Foundation` + `Win32_UI_WindowsAndMessaging` 等已在 windows crate 3.x 投影）。

### SpeechRecognizer 创建

```rust
use windows::Media::SpeechRecognition::{
    SpeechRecognizer, SpeechRecognitionResult, SpeechRecognitionTopicHint,
};
use windows::Globalization::Language;
use windows::core::HString;

let lang = Language::CreateLanguage(&HString::from(locale.unwrap_or("en-US")))?;
let recognizer = SpeechRecognizer::CreateAsync(&lang)?.await?;
// recognizer.Constraints() → Append dictation constraint:
recognizer.Constraints()?.Append(/* SpeechRecognitionTopicConstraint */ ...)?;
recognizer.CompileConstraintsAsync()?.await?;
```

### Dictation vs. Grammar

WinRT 有两种识别模式：
1. **Dictation（听写）** — 自由文本，最接近 macOS `SFSpeechURLRecognitionRequest` 的批处理语义。通过 `SpeechRecognitionTopicConstraint` + `Scenario.Dication` 或 `SpeechRecognitionListConstraint` 空 list 启用 `WebServiceGrammar.Dictation`。**这是 macOS 行为对齐的推荐模式**。
2. **Grammar（语法约束）** — 预定义 phrase list，准确度高但不适合通用文本输入。

听写模式示例：

```rust
use windows::Media::SpeechRecognition::{SpeechRecognitionTopicConstraint, SpeechRecognitionScenario};
let topic = SpeechRecognitionTopicConstraint::CreateWithHint(
    &HString::from(""),  // 空 hint = 自由 dictation
    &HString::from("Dictation"),  // topic keyword
)?;
recognizer.Constraints()?.Append(&topic)?;
```

### IAsyncOperation await 模式

windows-rs 把 `IAsyncOperation<T>` 实现成 `Future`，可直接 `.await`：

```rust
let result: SpeechRecognitionResult = recognizer
    .RecognizeWithUIAsync()?  // 或 RecognizeAsync（无 UI）
    .await?;
let text: HString = result.Text()?;
```

**必须在 tokio runtime** — windows-rs 的 Future 不 Send-friendly 早期版本有问题，3.x 已修复。`tauri::async_runtime::spawn_blocking` 桥接不可用（WinRT 对象有 STA 线程亲缘性），**应直接在 `#[tauri::command] async fn` 里 await**，不要 spawn_blocking。

### 离线 / 语言包依赖

- WinRT `SpeechRecognizer` 默认走 **online WebService grammar**（Microsoft 云识别）。
- **离线**需用户在「设置 → 时间和语言 → 语言和区域 → 添加语言」勾选"语音识别"子功能。系统会下载该语言的本地 SRH 引擎。
- 在代码中检测：`SpeechRecognizer::SupportedTopicLanguages()` 集合判断当前是否可用；首次 `CreateAsync(&lang)` 失败或 `RecognizeAsync` 报错时提示用户去设置装语言包。
- 对齐 macOS `wait_until_available` 轮询（`apple_speech.rs:440-455`）—— Windows 等价：try `recognizer.CurrentAudioDeviceId()` / state probe，或在 `RecognizeAsync` 包一层超时（与 `recognition_wait_budget` 同思路）。

### 麦克风权限

- cpal WASAPI 在首次 `build_input_stream` 时 Windows 会弹 Consent UI（麦克风隐私）。
- 显式 `MediaCapture`（`Media_Capture` feature）用于自定义 UI 授权流，**macOS 当前 `voice_start` 显式 `permissions::ensure_microphone`** —— Windows 上若依赖 cpal 隐式弹框，可省 MediaCapture；若要前置显式授权框（UX 与 macOS 对齐），需 `MediaCapture::InitializeAsync` + `MediaCaptureInitializationSettings` 设 `StreamingCaptureMode::Audio`，结果 `MediaCaptureFailed` 事件做兜底。**推荐首版省 MediaCapture，靠 cpal 隐式弹**，UX 简单且不引新 feature。

## 替代 crate 评估

| Crate | 评估 |
|---|---|
| `windows` (microsoft/windows-rs) | **推荐**。Microsoft 官方维护，feature 投影全，3.x 稳定。社区 issue 活跃。 |
| `windows-sys` | 不含 WinRT 投影，**不适合** SpeechRecognition。已用于 DPAPI（`Cargo.toml:143`）。 |
| `winrt-notification` / `winrt-speech` | 社区 crate，多年未更新，绑定到早期 winrt crate（已废弃，被 windows-rs 取代）。**不推荐**。 |
| `enigo` | SendInput/CGEvent 抽象，不含 Speech。 |

## 与 macOS 实现的差异点

| 维度 | macOS | Windows |
|---|---|---|
| FFI 风格 | objc2 `msg_send!` 手写 | windows-rs 类型投影，强类型 `.await` |
| 临时文件 | `std::env::temp_dir()` wav | 同 |
| 多话段累积 | `SegmentAccumulator`（apple_speech.rs:640-753）| WinRT dictation 返回**单次完整文本**（不分段），无需 SegmentAccumulator；直接 `result.Text()` |
| 取消 | `cancel_flag` + `-[SFSpeechRecognitionTask cancel]` | `recognizer.StopRecognitionAsync()` + `cancel_flag` 检查；WinRT RecognizeAsync 不可中途取消（一次性），cancel = 丢弃结果 |
| on-device | `requiresOnDeviceRecognition` (supportsOnDeviceRecognition) | 默认云，离线需语言包 |
| 权限 | 三框（麦克风/语音识别/辅助功能）| 麦克风（cpal 隐式），无辅助功能，无独立"语音识别"权限 |

## 风险点

1. **windows crate 3.x 与 windows-sys 0.59 在同一 target 下共存** — 测试 `cargo check --target x86_64-pc-windows-msvc` 是否报 feature 重复；**推荐统一到 `windows` 3.x**，删 `windows-sys`，DPAPI 改 `windows::Win32::Security::Cryptography`。
2. **WinRT STA 线程亲缘性** — `SpeechRecognizer` 对象不能跨 STA 传递；`spawn_blocking` 不可用，必须 `async fn` + `.await`。Tauri 的 async command 走 tokio multi-thread runtime，对象 thread-safe 但需 `Send`，3.x 已 `Send`。
3. **离线不可控** — 用户未装语言包时 `RecognizeAsync` 报错，需在前置 `CreateAsync` 后 probe `SupportedTopicLanguages` 提前失败并引导。
4. **无 partial 流式** — WinRT dictation 是一次性返回完整文本（或 UI 弹框），不像 Apple partial 累积。可接受（PRD 首版批处理即可）。
5. **Cargo.toml feature 列表精确度** — 多一个 feature 编译时间膨胀，少一个 link error。**macOS host 无法 cargo check --target msvc 验证**，需 Windows host 一次完整 `cargo check`。

## Caveats / Not Found

- 未动态验证 `windows` crate 3.x 在 `Media_SpeechRecognition` feature 下与 Tauri 2 + tokio 的 runtime 兼容性（windows-rs issue tracker 有报告 STA 在 tokio runtime 下偶发 hang，3.x 修复状态待 Windows host 验证）。
- `SpeechRecognitionTopicConstraint` 在 WinRT 文档与 windows-rs 投影的具体签名需 `cargo doc --open` 后核对；本调研基于对 windows-rs 投影惯例的既有知识。
- 离线语言包的 Programmatic detection API（`SpeechRecognizer::SupportedTopicLanguages`）在 windows-rs 是否已投影待 Windows host `cargo check` 验证。
