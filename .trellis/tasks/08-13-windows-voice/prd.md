# Windows Voice Module: WinRT Speech + SendInput + MediaCapture

## Goal

让语音输入在 Windows 11 上可用。覆盖 PRD `08-12-windows` R15 voice 模块 Windows 原生重写。

## Parent

`.trellis/tasks/08-12-windows` (R15 voice 模块 Windows 原生重写 — DEFERRED)

## Workflow

**PRD 明确要求**：先 `trellis-research` 调研 WinRT Speech + SendInput + MediaCapture 在 Rust 的成熟方案，再独立子任务实现。

本任务当前阶段：**research only**。产出 `research/` 目录下的调研文档，**不实现代码**。实现阶段另起 sub-task 或在 research 完成后由 main session 评估决定。

## Research Scope

### 1. WinRT SpeechRecognition

- `windows` crate `Media_SpeechRecognition` feature 的成熟度：API 稳定性、`SpeechRecognizer` 创建、`Constraints`（dictation vs. grammar）、异步结果类型 (`IAsyncOperation<SpeechRecognitionResult>`) 在 Rust 的 `await` 模式
- 替代方案：`windows-rs` 直接 bindings vs. `winrt-notification` / `winrt-speech` 等社区封装
- macOS 现有 `apple_speech` 模块 (`apps/desktop/src-tauri/src/voice.rs:67` 附近 `AppleSpeechAsr`) 的接口形状，Windows 实现需对齐
- 关键问题：Windows SpeechRecognizer 是否需要 en-US 语言包预装？是否能在无网络下工作？
- 麦克风权限：`Media_Capture` feature + `MediaCapture` 初始化时 Windows 弹权限对话框的流程

### 2. SendInput 模拟键盘（Cmd→Ctrl+V 等价）

- macOS 现有 `voice_insert_text` 走 CGEvent Cmd+V（`voice.rs` line ~522 附近 `paste_log` 注释引用了 release-build bug）
- Windows 等价：`user32::SendInput` + `VK_CONTROL` + `VK_V` 的 keydown/keyup 序列
- 关键问题：SendInput 注入到当前前台窗口（不是 Quill 自己）— 需在 macOS 行为对齐（macOS 也是注入到前台应用，不是 Quill）
- 剪贴板预填：macOS 用 `NSPasteboard`，Windows 用 `OpenClipboard` + `SetClipboardData` — 是否走 Tauri 2 的剪贴板插件更稳？
- `paste_log` 路径（PRD R11）：已改为 `dirs::cache_dir().join("quill/logs")`，验证 Windows 上 `%LOCALAPPDATA%\...\quill\logs` 落位

### 3. cpal 跨平台录音

- PRD 已确认 cpal 跨平台（`voice::recorder` 模块在 macOS 上是 cpal → 16kHz mono Int16 PCM）
- 调研：Windows 上 cpal 用 WASAPI 后端，是否有 sample rate / channel 转换的坑
- 验证：`voice::recorder` 模块的 cfg-gate 现状（grep `cfg(target_os = "macos")` in `voice/recorder.rs`）

### 4. 前端门控移除

- `apps/desktop/src/components/ai/VoiceInputButton.tsx:31` `onMac()` 函数
- `apps/desktop/src/hooks/useVoiceInput.ts:60` `onMac()` 函数
- `apps/desktop/src/components/settings/VoiceSettings.tsx:140` `onMac` 标志
- 调研：替换为 `isTauri()` + 平台检测 `isWindowsPlatform()`（已存在于 `apps/desktop/src/utils/shellSidecar.ts:24`）后，UI 与状态机是否完整支持 Windows 路径
- `t('settings:voice.windowsUnsupported')` 文案在 Windows 上需替换为可用状态

### 5. 命令注册与 invoke_handler

- `apps/desktop/src-tauri/src/lib.rs` line 192/236/257/282 等 `#[cfg(target_os = "macos")]` 块：voice 命令注册路径
- 调研：Windows 上 voice 命令需要无条件注册（或在 Windows cfg 下注册 Windows 实现），前端 invoke 不应失败
- 当前 macOS-only stub 模式（PRD 提到 "macOS-only stub + 前端 `onMac()` 隐藏入口已让 Windows 用户无 broken 行为"）— 调研在 voice 实装后如何过渡

## Deliverables

- `.trellis/tasks/08-13-windows-voice/research/winrt-speech.md` — WinRT SpeechRecognition 在 Rust 的成熟方案、推荐 crate/feature 组合、API 调用示例、macOS `apple_speech` 接口对齐点
- `.trellis/tasks/08-13-windows-voice/research/sendinput-paste.md` — SendInput + 剪贴板路径、与 macOS CGEvent Cmd+V 的行为差异、`paste_log` Windows 落位
- `.trellis/tasks/08-13-windows-voice/research/cpal-windows.md` — cpal 在 Windows 的已知坑、是否需要 cfg-gate 调整
- `.trellis/tasks/08-13-windows-voice/research/frontend-gating.md` — 前端 `onMac()` 替换为平台检测的改动点清单、i18n 文案调整
- `.trellis/tasks/08-13-windows-voice/research/summary.md` — 推荐实现路径（windows-rs feature 列表 + 模块拆分 + 风险点）、实现 PR 的拆分建议（单 PR or 多 PR）

## Acceptance Criteria

- 5 份 research 文档齐全，每份 ≤ 300 行
- summary.md 给出明确的实现路径推荐 + crate/feature 选择 + 风险点
- 实现阶段可以直接基于 research 产出开始编码，无需再调研

## Out of Scope

- 实际实现代码（本任务只 research）
- pet 模块（见 `08-13-windows-pet` 子任务）
- Chrome DPAPI（已在 `08-12-windows` PR5 排期）

## Technical Notes

- macOS host 无法动态验证 Windows native API 调用 — research 阶段以文档调研 + 代码 grep + crate 仓库 issue 扫读为主，不写可运行 demo
- `windows` crate 的 feature flag 组合在 Cargo.toml 是显式列出，research 阶段需给出精确的 feature 列表（避免 `cargo check --target x86_64-pc-windows-msvc` 失败）
