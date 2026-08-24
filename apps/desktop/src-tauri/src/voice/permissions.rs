//! 系统权限请求 / 检查（macOS）。
//!
//! 端口自 openless `permissions.rs`（仅 macOS 子集 — Windows 走 cpal 隐式
//! 首次提示，本模块不编译）。与 `apple_speech.rs::ensure_authorized`（语音
//! 识别权限）配套：本模块负责麦克风 + 辅助功能两条权限链路。
//!
//! - 麦克风：`AVAudioApplication.requestRecordPermissionWithCompletionHandler:`
//!   （AVFAudio / macOS 14+），回落 `AVCaptureDevice.requestAccessForMediaType:
//!   completionHandler:`（AVFoundation / 老 macOS）。8 秒兜底。
//! - 辅助功能：`AXIsProcessTrustedWithOptions({kAXTrustedCheckOptionPrompt:
//!   true})`（ApplicationServices + CoreFoundation）—— 弹系统授权框。
//!
//! 系统框架链接走 `#[link(name = "...", kind = "framework")]`，零 Cargo 依赖
//! （`objc2` + `block2` 已在 `Cargo.toml`）。

#![cfg(target_os = "macos")]

use std::ffi::c_void;
use std::sync::mpsc;
use std::time::Duration;

/// 等待权限 block 回调的兜底超时（与 openless 同步）。cpal/AVFoundation 偶尔
/// 在系统弹框被用户长时间忽略时不回调 —— 兜底防线程卡死。
const PERMISSION_WAIT: Duration = Duration::from_secs(8);

// ── Accessibility: ApplicationServices + CoreFoundation ──

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXIsProcessTrusted() -> bool;
    fn AXIsProcessTrustedWithOptions(options: *const c_void) -> bool;
    static kAXTrustedCheckOptionPrompt: *const c_void;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFDictionaryCreate(
        allocator: *const c_void,
        keys: *const *const c_void,
        values: *const *const c_void,
        num_values: isize,
        key_callbacks: *const c_void,
        value_callbacks: *const c_void,
    ) -> *const c_void;
    fn CFRelease(cf: *const c_void);
    static kCFTypeDictionaryKeyCallBacks: c_void;
    static kCFTypeDictionaryValueCallBacks: c_void;
    static kCFBooleanTrue: *const c_void;
}

/// 当前是否已获辅助功能授权（不弹框）。
pub fn check_accessibility() -> bool {
    // SAFETY: 无参 C 函数返回 bool，调用恒安全。
    unsafe { AXIsProcessTrusted() }
}

/// 弹系统辅助功能授权框（仅在未授权时弹），返回当前授权状态。
pub fn request_accessibility() -> bool {
    // SAFETY: 构造单元素 CFDictionary `{kAXTrustedCheckOptionPrompt: kCFBooleanTrue}`
    // 并传给 `AXIsProcessTrustedWithOptions` —— 这是 Apple 文档承诺的「弹框」调用
    // 形式。CFDictionaryCreate 的 key/value callbacks 用 CoreFoundation 提供的
    // 静态 `kCFType*DictionaryCallBacks`（对 NSNotificationCenter/NSString 安全）。
    // 字典用完即 `CFRelease`。
    unsafe {
        let keys: [*const c_void; 1] = [kAXTrustedCheckOptionPrompt];
        let values: [*const c_void; 1] = [kCFBooleanTrue];
        let dict = CFDictionaryCreate(
            std::ptr::null(),
            keys.as_ptr(),
            values.as_ptr(),
            1,
            &kCFTypeDictionaryKeyCallBacks as *const _ as *const c_void,
            &kCFTypeDictionaryValueCallBacks as *const _ as *const c_void,
        );
        let trusted = AXIsProcessTrustedWithOptions(dict);
        CFRelease(dict);
        trusted
    }
}

// ── Microphone: AVFAudio (macOS 14+) → AVFoundation (older) ──

#[link(name = "AVFoundation", kind = "framework")]
extern "C" {
    // 直接拿 AVFoundation 导出的 NSString 静态符号；不用从 Rust 串构造 NSString。
    static AVMediaTypeAudio: *const c_void;
}

// AVAudioApplication 在 AVFAudio 框架（macOS 14+）。类不存在即回落到
// AVCaptureDevice 路径（老 macOS）。空 extern 块仅为链接指示。
#[link(name = "AVFAudio", kind = "framework")]
extern "C" {}

/// 麦克风权限状态（Apple 四值映射）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MicStatus {
    Granted,
    Denied,
    NotDetermined,
    Restricted,
}

/// 检查麦克风权限（不弹框）。类不存在 → NotDetermined（让上层走 request 路径）。
pub fn check_microphone() -> MicStatus {
    if let Some(s) = check_via_avaudio_application() {
        return s;
    }
    check_via_avcapture_device()
}

/// 弹系统麦克风授权框并等待结果（8 秒兜底，超时回落到 check）。
pub fn request_microphone() -> MicStatus {
    if let Some(s) = request_via_avaudio_application() {
        return s;
    }
    request_via_avcapture_device()
}

/// `ensure_microphone`: 录音启动前同步请求麦克风权限。
///
/// - NotDetermined → 主动请求系统授权框（用户答 Granted/Denied 后返回）。
/// - Granted → 直接 Ok。
/// - Denied/Restricted → 返回清晰错误字符串，上层 surface 给用户。
///
/// 与 openless `coordinator/dictation.rs::ensure_microphone_permission` 同源
/// 思路：在 `Recorder::start` 之前主动请求，而不是依赖 cpal 的隐式首次提示
/// （cpal 在 `.app` stub 包装 / 之前拒绝过 TCC 的场景下隐式提示不可靠）。
pub fn ensure_microphone() -> Result<(), String> {
    match check_microphone() {
        MicStatus::Granted => Ok(()),
        MicStatus::NotDetermined => match request_microphone() {
            MicStatus::Granted => Ok(()),
            MicStatus::Denied => Err(
                "麦克风权限被拒绝，请在 系统设置 → 隐私与安全性 → 麦克风 中允许 Folyn".into(),
            ),
            other => Err(format!("麦克风授权未获批准（状态 {:?}）", other)),
        },
        MicStatus::Denied => Err(
            "麦克风权限被拒绝，请在 系统设置 → 隐私与安全性 → 麦克风 中允许 Folyn".into(),
        ),
        MicStatus::Restricted => Err("此设备的麦克风功能受限".into()),
    }
}

fn check_via_avaudio_application() -> Option<MicStatus> {
    use objc2::msg_send;
    use objc2::runtime::{AnyClass, AnyObject};

    // 类不存在 = 老 macOS（< 14），回落到 AVCaptureDevice 路径。
    let cls = AnyClass::get("AVAudioApplication")?;
    let shared: *mut AnyObject = unsafe { msg_send![cls, sharedInstance] };
    if shared.is_null() {
        log::warn!("[mic] AVAudioApplication sharedInstance returned null");
        return None;
    }
    // AVAudioApplicationRecordPermission 是 NS_ENUM(NSInteger, ...) FourCC：
    //   'grnt' = 0x67726e74 = 1735552628
    //   'deny' = 0x64656e79 = 1684368761
    //   'undt' = 0x756e6474 = 1970168948
    let perm: i64 = unsafe { msg_send![shared, recordPermission] };
    let mapped = match perm {
        0x6772_6e74 => MicStatus::Granted,
        0x6465_6e79 => MicStatus::Denied,
        0x756e_6474 => MicStatus::NotDetermined,
        _ => MicStatus::NotDetermined,
    };
    log::info!("[mic] AVAudioApplication.recordPermission raw=0x{:x} → {:?}", perm, mapped);
    Some(mapped)
}

fn request_via_avaudio_application() -> Option<MicStatus> {
    use block2::RcBlock;
    use objc2::msg_send;
    use objc2::runtime::{AnyClass, Bool};

    let cls = AnyClass::get("AVAudioApplication")?;
    let (tx, rx) = mpsc::channel();
    let block = RcBlock::new(move |granted: Bool| {
        let _ = tx.send(granted.as_bool());
    });

    log::info!("[mic] requesting via AVAudioApplication.requestRecordPermission");
    // SAFETY: `requestRecordPermissionWithCompletionHandler:` 接收一个
    // `void(^)(BOOL)` block，`&*block` 是 block2 稳定指针，block 本体由 `block`
    // 持有到本作用域结束 —— 回调在系统弹框被用户应答后触发，发生在
    // `rx.recv_timeout` 返回之前，因此 block 生命周期足够覆盖回调。
    unsafe {
        let _: () = msg_send![cls, requestRecordPermissionWithCompletionHandler: &*block];
    }

    let mapped = match rx.recv_timeout(PERMISSION_WAIT) {
        Ok(true) => MicStatus::Granted,
        Ok(false) => MicStatus::Denied,
        Err(err) => {
            log::warn!("[mic] AVAudioApplication request timeout/error: {err}");
            check_via_avaudio_application().unwrap_or(MicStatus::NotDetermined)
        }
    };
    log::info!("[mic] AVAudioApplication.requestRecordPermission → {:?}", mapped);
    Some(mapped)
}

fn check_via_avcapture_device() -> MicStatus {
    use objc2::msg_send;
    use objc2::runtime::AnyClass;

    let Some(cls) = AnyClass::get("AVCaptureDevice") else {
        return MicStatus::NotDetermined;
    };
    // SAFETY: `[AVCaptureDevice authorizationStatusForMediaType:]` 类方法，参数为
    // AVMediaTypeAudio 静态 NSString 符号，返回 NSInteger (i64)。
    let status: i64 = unsafe { msg_send![cls, authorizationStatusForMediaType: AVMediaTypeAudio] };
    let mapped = match status {
        3 => MicStatus::Granted,
        2 => MicStatus::Denied,
        1 => MicStatus::Restricted,
        0 => MicStatus::NotDetermined,
        _ => MicStatus::NotDetermined,
    };
    log::info!("[mic] AVCaptureDevice.authStatus raw={} → {:?}", status, mapped);
    mapped
}

fn request_via_avcapture_device() -> MicStatus {
    use block2::RcBlock;
    use objc2::msg_send;
    use objc2::runtime::{AnyClass, Bool};

    let Some(cls) = AnyClass::get("AVCaptureDevice") else {
        return MicStatus::NotDetermined;
    };
    let (tx, rx) = mpsc::channel();
    let block = RcBlock::new(move |granted: Bool| {
        let _ = tx.send(granted.as_bool());
    });

    log::info!("[mic] requesting via AVCaptureDevice.requestAccessForMediaType");
    // SAFETY: `requestAccessForMediaType:completionHandler:` 接收一个
    // `void(^)(BOOL)` block，参数为 AVMediaTypeAudio 静态 NSString。同上生命周期。
    unsafe {
        let _: () = msg_send![
            cls,
            requestAccessForMediaType: AVMediaTypeAudio
            completionHandler: &*block
        ];
    }

    let mapped = match rx.recv_timeout(PERMISSION_WAIT) {
        Ok(true) => MicStatus::Granted,
        Ok(false) => MicStatus::Denied,
        Err(err) => {
            log::warn!("[mic] AVCaptureDevice request timeout/error: {err}");
            check_via_avcapture_device()
        }
    };
    log::info!("[mic] AVCaptureDevice.requestAccess → {:?}", mapped);
    mapped
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 冒烟：`check_microphone` 不 panic、不挂线程（即使未授权也只读取状态）。
    /// 不测 `request_*` —— 它们触发系统 UI，只能在手工 QA 验证。
    #[test]
    fn check_microphone_does_not_panic() {
        let _ = check_microphone();
    }

    /// 冒烟：`check_accessibility` 同理。
    #[test]
    fn check_accessibility_does_not_panic() {
        let _ = check_accessibility();
    }
}
