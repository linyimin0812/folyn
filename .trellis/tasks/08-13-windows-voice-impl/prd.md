# Windows Voice Module: WinRT Speech + SendInput Implementation

## Goal

基于 `08-13-windows-voice` 子任务的 4 份 research 文档，实现 R15 voice 模块 Windows 原生重写。让语音输入在 Windows 11 上可用，行为对齐 macOS（mic 录音 → 语音识别 → 模拟粘贴到前台应用）。

## Parent & Research References

- Parent: `.trellis/tasks/08-12-windows` (R15 deferred)
- Research: `.trellis/tasks/08-13-windows-voice/research/`
  - `winrt-speech.md` — WinRT SpeechRecognition API + windows crate feature list
  - `sendinput-paste.md` — SendInput + clipboard 路径
  - `cpal-windows.md` — cpal cfg widen
  - `frontend-gating.md` — 前端 `onMac()` 替换点

## Requirements

### 1. Cargo.toml 依赖（`apps/desktop/src-tauri/Cargo.toml`）

按 research summary 调整：

```toml
[target.'cfg(any(target_os = "macos", target_os = "windows"))'.dependencies]
cpal = "0.15"
parking_lot = "0.12"
anyhow = "1"

[target.'cfg(target_os = "windows")'.dependencies]
windows = { version = "3", features = [
  "Media_SpeechRecognition",
  "Globalization",
  "Foundation",
  "Storage",
  "Win32_UI_Input_KeyboardAndMouse",
  "Win32_UI_WindowsAndMessaging",
  "Win32_Foundation",
  "Win32_Security_Cryptography",
  "Win32_Graphics_Gdi",
  "Win32_UI_HiDpi",
] }
aes-gcm = "0.10"
base64 = "0.22"

[dependencies]
dirs = "5"
```

**注意**：research summary 提到"Delete windows-sys (unified into windows crate)"。但当前 `windows-sys` 已被 `pet_commands.rs` Windows 块 + DPAPI（`browser_commands.rs`）使用。**本任务不动 windows-sys**，保留双 crate 共存（windows-sys 用于已有 pet/DPAPI 路径，windows 用于新增 WinRT）。在 summary.md 风险点 2 已标注迁移是单独 PR。

### 2. 模块拆分（`apps/desktop/src-tauri/src/voice/`）

按 research summary 镜像 macOS 模块结构：

- [ ] `voice/winrt_speech.rs` — NEW windows-only，镜像 `apple_speech.rs` 的 `AppleSpeechAsr` 接口（new/buffer/transcribe/cancel + impl `AudioConsumer`）
- [ ] `voice/insertion_win.rs` — NEW windows-only，`user32::SendInput` 4-INPUT（Ctrl↓/V↓/V↑/Ctrl↑）+ `tauri-plugin-clipboard-manager` 预填剪贴板
- [ ] `voice/permissions_win.rs` — NEW windows-only no-op stub（WinRT 隐式处理麦克风权限，首次 `SpeechRecognizer::CreateAsync` 触发系统对话框）
- [ ] `voice/recorder.rs` line 14 `#![cfg(target_os = "macos")]` → `#![cfg(any(target_os = "macos", target_os = "windows"))]`
- [ ] `voice/wav.rs` 同样 cfg widen
- [ ] `voice/mod.rs` / `voice.rs` — 新增 `#[cfg(target_os = "windows")] mod winrt_speech;` 等声明；`voice_start` / `voice_stop` / `voice_insert_text` 命令在 Windows 分支用新模块

### 3. `paste_log` Windows 路径（PRD R11 已完成）

- [ ] 验证 `voice.rs` 的 `paste_log` 在 Windows 上落位 `%LOCALAPPDATA%\mochi\logs\mochi-voice-debug.log`（`dirs::cache_dir()` Windows 返回 `%LOCALAPPDATA%`）。如果 `dirs::cache_dir()` 返回 None 或路径不符，加 `dirs::cache_dir().or_else(|| dirs::data_dir())` fallback。

### 4. 前端门控移除

- [ ] `apps/desktop/src/utils/shellSidecar.ts` — 加 `isVoiceSupportedPlatform()`（`isTauri()` + `/Mac|Win/i.test(navigator.platform)`）+ `isMacPlatform()`（拆分现有 `onMac()` 逻辑）
- [ ] `apps/desktop/src/components/ai/VoiceInputButton.tsx:31` — `onMac()` → `isVoiceSupportedPlatform()`
- [ ] `apps/desktop/src/hooks/useVoiceInput.ts:60` — 同上
- [ ] `apps/desktop/src/components/settings/VoiceSettings.tsx:140` — `onMac` → 拆为 `isMac` + `isVoiceSupported`；macOS 专属权限行用 `isMac`，通用可用状态用 `isVoiceSupported`
- [ ] i18n 文案 `settings:voice.windowsUnsupported` → 通用不可用文案（macOS/Windows 都可用后，只剩 Linux 等不支持）。4 个 locale 文件（en/zh/ja/？）同步

### 5. lib.rs 命令注册

- [ ] `apps/desktop/src-tauri/src/lib.rs` line 192/236/257/282 等 `#[cfg(target_os = "macos")]` 块 — voice 命令注册路径。Windows 上 voice 命令应无条件注册（或在 Windows cfg 下注册 Windows 实现），前端 invoke 不应失败。当前 macOS-only stub 模式（`#[cfg(not(target_os = "macos"))]` 返回 `Err("voice input is macOS-only")`）需改为 `#[cfg(target_os = "windows")]` Windows 实现 + `#[cfg(not(any(target_os = "macos", target_os = "windows")))]` Linux no-op。

## Acceptance Criteria

- Windows 11 上 `voice_start` → 麦克风录音启动（cpal WASAPI）→ `voice_stop` → WinRT Speech 识别 → `voice_insert_text` SendInput Ctrl+V 粘贴到前台应用
- 前端 `VoiceInputButton` 在 Windows 上可见且可点击
- `VoiceSettings` 在 Windows 上显示可用配置项，无 `windowsUnsupported` 文案
- macOS 行为零回归（`#[cfg(target_os = "macos")]` 路径完全不动）
- `cargo check --target x86_64-pc-windows-msvc` 在 macOS host 通过（user 验证）
- 受影响模块 lint / typecheck 绿

## Out of Scope

- windows-sys → windows crate 迁移（单独 PR，research summary 风险点 2）
- voice-orb 窗口 Windows 实现（research summary 风险点 6 — MVP 不启用 orb，前端 fallback CSS ring）
- Chrome DPAPI（已在 `08-12-windows` PR5 排期）
- 代码签名

## Technical Notes

- macOS host 无法动态验证 Windows native API 调用 — 实现阶段以代码对齐 research 文档为主，Windows 11 验证由用户做
- WinRT `SpeechRecognizer` 必须在 async fn 里 `.await`，不能 `spawn_blocking`（STA 线程亲和性，research summary 风险点 3）
- 离线语言包：`RecognizeAsync` 在缺 en-US/zh-CN SR pack 时失败 — 需 `SupportedTopicLanguages` 预飞检查（research summary 风险点 4）
- SendInput 前台窗口竞争：Mochi 必须 `window.hide()` pre-paste（镜像 macOS `insertion.rs:680-699` hide-orb 模式，research summary 风险点 5）
- cpal Windows 错误分类：`recorder.rs:262-270` 用字符串 "denied" 判断权限拒绝 — Windows 错误字符串可能不同，改用 typed variants（research summary 风险点 7）

## Implementation Plan

- 单 PR，闭环 lint + typecheck + `cargo check --target x86_64-pc-windows-msvc` + Windows 11 验证
- 按研究 summary 的 commit 块标签 7a-7f 在 PR 描述中标注（实际单 commit）
