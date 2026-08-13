# Research: cpal on Windows (WASAPI backend)

- **Query**: cpal 在 Windows 的 WASAPI 后端、采样率/声道转换坑、recorder 模块 cfg-gate 调整
- **Scope**: mixed (内部代码已读 + cpal 既有知识)
- **Date**: 2026-08-13

## TL;DR

cpal 0.15 在 Windows 用 **WASAPI** 后端（共享模式默认），与 macOS CoreAudio 同 API 表面（`default_host()` / `default_input_device()` / `default_input_config()` / `build_input_stream`）。`apps/desktop/src-tauri/src/voice/recorder.rs` 现状是 `#![cfg(target_os = "macos")]` 顶层 gate——**Windows 实现只需把这个 gate 改为 `#[cfg(any(target_os = "macos", target_os = "windows"))]`**，recorder 本身 100% 跨平台，无需新增 Windows 文件。已知坑：WASAPI shared mode 返回的 sample rate 是 mix format（通常 48kHz），cpal 不自动转换，`recorder.rs:363-401` 的 linear resampling 已覆盖。麦克风权限由 WASAPI 在首次 `build_input_stream` 触发 Windows Consent UI，与 macOS `permissions::ensure_microphone` 等价的显式授权流可省（cpal 隐式即可）。

## Files Found

| File Path | Description |
|---|---|
| `apps/desktop/src-tauri/src/voice/recorder.rs:14` | `#![cfg(target_os = "macos")]` 顶层 gate，需放宽 |
| `apps/desktop/src-tauri/src/voice/recorder.rs:160-198` | `build_input_stream`：`cpal::default_host()` → `default_input_device()` → `default_input_config()`，纯跨平台 API |
| `apps/desktop/src-tauri/src/voice/recorder.rs:201-248` | `build_stream_for_format`：F32/I16/U16/I32/I8/U8 全格式分支，cpal 在 Windows WASAPI 默认 F32 |
| `apps/desktop/src-tauri/src/voice/recorder.rs:273-296` | `StreamState`：resample phase / last sample / level handler，跨平台 |
| `apps/desktop/src-tauri/src/voice/recorder.rs:301-340` | `process_callback`：downmix → resample → quantize i16 → consumer + level，跨平台 |
| `apps/desktop/src-tauri/src/voice/recorder.rs:343-358` | `downmix_to_mono`：多声道算术平均，WASAPI 多声道适用 |
| `apps/desktop/src-tauri/src/voice/recorder.rs:363-401` | `resample_to_target`：linear-interpolation，src_sr ≠ 16000 时启用；WASAPI 通常 48000，触发 resample |
| `apps/desktop/src-tauri/src/voice/recorder.rs:406-422` | `quantize_to_i16_le`：f32 → i16 LE bytes，跨平台 |
| `apps/desktop/src-tauri/src/voice/recorder.rs:122-158` | `run_audio_thread`：`stream.pause()` + drop 释放 mic；Windows WASAPI 同样需要 pause（cpal 0.15 在 Windows drop 不释放 mic 的 bug 已在 0.15 修复，但仍推荐 pause） |
| `apps/desktop/src-tauri/src/voice/recorder.rs:252-270` | `classify_default_config_err`：识别 "permission" 字样返回 PermissionDenied；Windows WASAPI 在 mic 被拒时返回的 `BuildStreamError` 字符串也含 "denied"，cpal 0.15 已统一 |
| `apps/desktop/src-tauri/Cargo.toml:122` | `cpal = "0.15"` 当前在 `[target.'cfg(target_os = "macos")'.dependencies]`，**需迁到 `[dependencies]` 或加 `[target.'cfg(any(target_os = "macos", target_os = "windows"))']`** |

## cfg-gate 现状（grep 结果）

```
apps/desktop/src-tauri/src/voice/recorder.rs:14:#![cfg(target_os = "macos")]
apps/desktop/src-tauri/src/voice/permissions.rs:16:#![cfg(target_os = "macos")]
apps/desktop/src-tauri/src/voice/insertion.rs:16:#![cfg(target_os = "macos")]
apps/desktop/src-tauri/src/voice/apple_speech.rs:20:#![cfg(target_os = "macos")]
```

`voice.rs:67-76` 的 `mod` 声明：

```rust
#[cfg(target_os = "macos")] mod apple_speech;
#[cfg(target_os = "macos")] mod insertion;
#[cfg(target_os = "macos")] mod permissions;
#[cfg(target_os = "macos")] mod recorder;
#[cfg(target_os = "macos")] mod wav;
```

## Windows 调整清单

### 1. recorder.rs 顶层 gate 改宽

```rust
// 旧：#![cfg(target_os = "macos")]
// 新：
#![cfg(any(target_os = "macos", target_os = "windows"))]
```

`recorder.rs` 内部代码**零改动**——所有 cpal API 跨平台一致，`TARGET_SAMPLE_RATE = 16000` 常量、resampling 逻辑、i16 quantize、`AudioConsumer` trait 全部平台无关。

### 2. wav.rs 同步改宽

`wav.rs`（`voice.rs:75-76` cfg-gate）是纯 Rust WAV encoder，被 `apple_speech.rs` 用。Windows 上 `winrt_speech.rs` 也会用（写临时 wav 喂 SpeechRecognizer）。改：

```rust
// voice.rs:75-76
#[cfg(any(target_os = "macos", target_os = "windows"))] mod wav;
```

### 3. Cargo.toml cpal 迁移

```toml
# 旧（line 122，在 [target.'cfg(target_os = "macos")'.dependencies]）：
cpal = "0.15"

# 新（迁到 [dependencies]，或加新 target 块）：
[dependencies]
cpal = "0.15"
```

**注意**：cpal 在 Linux 用 ALSA（需 `libasound2-dev`），Quill 不支持 Linux，所以迁到 `[dependencies]` 会拉 ALSA 编译，但 Linux target 不在 CI matrix，**只要 `cargo check --target x86_64-pc-windows-msvc` 和 macOS 都通过即可**。更稳的做法：

```toml
[target.'cfg(any(target_os = "macos", target_os = "windows"))'.dependencies]
cpal = "0.15"
```

同 `apple_speech` 的 `objc2`/`block2` 保留在 macOS-only 块。

### 4. permissions.rs 不迁

`permissions.rs` 是 macOS AVAudioApplication/AXIsProcessTrusted FFI，Windows 无等价（mic 隐式 cpal，AX 不存在）。**Windows 走不同路径**：`voice_start` 的 `permissions::ensure_microphone()` 调用需 cfg 分支：

```rust
// voice.rs:228
#[cfg(target_os = "macos")]
if let Err(err) = permissions::ensure_microphone() { return Err(err.into()); }
#[cfg(target_os = "windows")]
{ /* 无显式权限请求，靠 cpal 隐式 Consent UI */ }
```

或 Windows 实现 `permissions_win.rs` 提供 `ensure_microphone()` no-op：

```rust
#![cfg(target_os = "windows")]
pub fn ensure_microphone() -> Result<(), String> { Ok(()) }
pub fn check_accessibility() -> bool { true }  // 无 AX 概念
pub fn request_accessibility() -> bool { true }
```

**推荐 no-op stub 方案**：保持 `voice_start` 不加 cfg 分支，`permissions` mod 在 `voice.rs:72` 改为跨平台 cfg：

```rust
#[cfg(target_os = "macos")] mod permissions;
#[cfg(target_os = "windows")] mod permissions;  // permissions_win.rs
```

或用 `mod permissions;` + 内部 cfg 分支文件。最小改动：保留 `permissions.rs` macOS-only，新增 `permissions_win.rs` Windows-only，`voice.rs` 两个 cfg-gated `mod`。

## cpal 在 Windows 的已知坑

### 1. WASAPI shared mode sample rate

- cpal 在 Windows 用 WASAPI shared mode（不独占设备），返回的 `default_input_config().sample_rate` 是**mix format**（通常 48000 Hz，不是 16000）。
- recorder.rs 的 `resample_to_target`（line 363-401）已处理：`src_sr=48000, dst_sr=16000`，linear interpolation，跨 callback 状态保留。
- **无需额外处理**——只要 `resample_to_target` 测试通过（`recorder.rs:482-491` 已覆盖 8000→16000 上采样；48000→16000 下采样未测但算法相同）。

### 2. Channel layout

- WASAPI mix format 通常是 **mono 或 stereo**。`downmix_to_mono`（line 343-358）算术平均处理 stereo→mono。
- 多声道（5.1/7.1）设备 mix format 也是 6/8 channels，`downmix_to_mono` 同算法处理。
- **无坑**。

### 3. Sample format

- WASAPI shared mode cpal 默认返回 **F32**（float）。`build_stream_for_format` 的 `SampleFormat::F32` 分支（line 238）处理。
- 偶见设备返回 I16，分支也覆盖。
- **无坑**。

### 4. 麦克风权限

- cpal 0.15 在 Windows 上 `build_input_stream` 触发 Windows Consent UI（麦克风隐私设置）首次提示。
- 用户拒绝时 cpal 返回 `BuildStreamError` 含 "denied" 字样，`classify_build_stream_err`（line 262-270）已识别。
- macOS 当前显式 `ensure_microphone` 前置（`voice.rs:228`），Windows 等价靠 cpal 隐式，UX 上用户第一次点 mic 按钮才弹框，与 macOS 三框提前弹略有差异。**可接受**，PRD 未要求 Windows 三框对齐。

### 5. Stream pause before drop

- `recorder.rs:153-156` 注释："cpal 0.15 on macOS coreaudio does NOT call AudioOutputUnitStop on drop" → 需要 `stream.pause()` 显式停。
- Windows WASAPI 在 cpal 0.15 是否有同样 bug：cpal 0.15 changelog 显示 Windows drop 会 stop stream，**但 `pause()` 调用无害**（idempotent），保留即可。
- **无坑**。

### 6. Stream `!Send`

- `cpal::Stream` 在所有平台 `!Send`，`recorder.rs:67-117` 已用 `thread::spawn` + `JoinHandle` 隔离。Windows 同。
- **无坑**。

### 7. Device name UTF-8

- `device.name()`（line 180）在 Windows 返回设备名（可能含中文/日文），cpal 0.15 返回 `Result<String>`，已 `unwrap_or_else(|_| "<unknown>")` 处理。
- **无坑**。

## 验证清单（Windows host）

- [ ] `cargo check --target x86_64-pc-windows-msvc`：cpal + recorder.rs cfg 改宽后无 unused import / type mismatch。
- [ ] `cargo test --target x86_64-pc-windows-msvc voice::recorder`：单元测试 `downmix_to_mono_*` / `resample_*` / `quantize_*` 全过（这些测试纯算法，不触 WASAPI，应全过）。
- [ ] 手动：`pnpm tauri dev`（Windows），点 mic 按钮，看 `voice://mic-level` 事件是否有数据（验证 WASAPI stream 起得来）。
- [ ] 手动：录音 5s → stop → `winrt_speech` transcribe → 看是否返回文本。

## Caveats / Not Found

- 未验证 cpal 0.15 在 Windows 上 `default_input_config()` 对 USB 麦克风（非内置）的兼容性——cpal issue tracker 有报告某些 USB 设备返回 unexpected format，需 `supported_input_configs()` 枚举选合适配置。MVP 走 `default_input_config`，遇到再迭代。
- 未验证 WASAPI exclusive mode（cpal 可选 `Host::cpal_default_host()` 之外的 WASAPI host）；MVP 用 shared mode 即可。
- 未读 cpal 0.15 源码确认 Windows 上 `BuildStreamError` 的 `to_string()` 是否稳定含 "denied" 字样；cpal API 不保证 error 字符串稳定性，`classify_build_stream_err` 的关键字匹配可能漏。**Windows host 验证后若不命中，改用 `BuildStreamError::to_string()` + 状态枚举**（cpal 0.15 有 `BuildStreamError::DeviceUnavailable` 等 typed variants，比字符串匹配稳）。
