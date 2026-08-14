//! 系统权限请求 / 检查 — Windows no-op stub.
//!
//! WinRT `SpeechRecognizer` 隐式处理麦克风权限：首次 `CreateAsync` 触发
//! 系统 Consent UI。无独立"语音识别"权限概念。无 Accessibility 概念
//! （SendInput 不需权限，UIPI 在普通用户场景下无影响）。
//!
//! 本模块只保留 Windows `voice_start` 实际调用的 `ensure_microphone`
//! （no-op），让两个平台的 `voice_start` 共用调用代码，避免 cfg 分支
//! 散落到调用点。其余 macOS `permissions.rs` 的镜像函数（`check_*` /
//! `request_*` / `MicStatus`）在 Windows 无调用点，已删除——保留只会
//! 在 Windows 编译时触发 `dead_code`。
//!
//! 非 Windows 平台不编译本模块（`#![cfg(target_os = "windows")]` 顶层门控）。

#![cfg(target_os = "windows")]

/// No-op: WinRT `SpeechRecognizer` 首次创建时隐式触发系统麦克风 Consent
/// UI，无需显式预检。OK 返回让 `voice_start` 直接进入识别会话。
pub fn ensure_microphone() -> Result<(), String> {
    Ok(())
}
