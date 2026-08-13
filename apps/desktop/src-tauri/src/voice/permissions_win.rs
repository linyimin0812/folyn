//! 系统权限请求 / 检查 — Windows no-op stub.
//!
//! WinRT `SpeechRecognizer` 隐式处理麦克风权限：首次 `CreateAsync` 触发
//! 系统 Consent UI。无独立"语音识别"权限概念。无 Accessibility 概念
//! （SendInput 不需权限，UIPI 在普通用户场景下无影响）。
//!
//! 本模块提供与 macOS `permissions.rs` 等价的 `ensure_microphone` 等
//! 函数签名（no-op），让 `voice_start` 命令在两个平台共用调用代码，
//! 避免 cfg 分支散落到调用点。
//!
//! 非 Windows 平台不编译本模块（`#![cfg(target_os = "windows")]` 顶层门控）。

#![cfg(target_os = "windows")]

/// No-op: WinRT / cpal WASAPI 隐式处理麦克风权限。OK 返回让 voice_start
/// 走 cpal build_input_stream，首次构建触发 Consent UI。
pub fn ensure_microphone() -> Result<(), String> {
    Ok(())
}

/// Windows 无 Accessibility 概念。SendInput 不需权限。
pub fn check_accessibility() -> bool {
    true
}

/// No-op: Windows 无 Accessibility 弹框。`voice_request_accessibility`
/// 命令在 Windows cfg 路径下不会调用本函数（命令本身返回 false 直接
/// short-circuit，但保留此函数让 macOS/Windows 共用 mod 声明）。
pub fn request_accessibility() -> bool {
    true
}

/// Windows 麦克风权限状态简化为 Granted（cpal 隐式弹框处理）。
/// 镜像 macOS `MicStatus` enum 的 Granted 分支，让 voice_start 在两个
/// 平台共用 `ensure_microphone` 签名。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MicStatus {
    Granted,
    Denied,
    NotDetermined,
    Restricted,
}

pub fn check_microphone() -> MicStatus {
    // ponytail: WASAPI 没有同步权限状态 API（cpal 0.15 也不暴露），故默认
    // NotDetermined 让 ensure_microphone 走隐式触发路径。Windows 上真正
    // 的拒绝会在 cpal build_input_stream 报错，由 classify_build_stream_err
    // 识别为 PermissionDenied。
    MicStatus::NotDetermined
}

pub fn request_microphone() -> MicStatus {
    // Windows 无法主动弹框（无 AVCaptureDevice.requestAccessForMediaType 等价）；
    // 调用者应依赖 cpal 隐式 Consent UI。这里返回当前状态。
    MicStatus::NotDetermined
}
