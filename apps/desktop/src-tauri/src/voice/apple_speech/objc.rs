//! `SFSpeechRecognizer` objc2 桥接的低层辅助：类查找、对象构造、NSString/NSError 转换。
//! 供 `recognize`（批处理识别主体）与 `lifecycle`（回调解包）复用，不包含业务逻辑。

use objc2::runtime::{AnyClass, AnyObject};
use objc2::msg_send;

use anyhow::{anyhow, bail, Context, Result};

pub(super) fn speech_recognizer_class() -> Result<&'static AnyClass> {
    AnyClass::get("SFSpeechRecognizer").ok_or_else(|| {
        anyhow!("SFSpeechRecognizer 类不可用（需要 macOS 10.15+ 并链接 Speech.framework）")
    })
}

/// 创建 recognizer。有指定 locale 就 `initWithLocale:`（关键 —— 否则落到系统首选语言，
/// 中文语音会被英文引擎误识别）；无 locale 或 NSLocale 构造失败时回退 `init`（系统默认）。
pub(super) fn create_recognizer(locale: Option<&str>) -> Result<*mut AnyObject> {
    let cls = speech_recognizer_class()?;
    let recognizer: *mut AnyObject = match locale.and_then(ns_locale) {
        Some(ns_loc) => {
            log::info!(
                "[apple-speech] recognizer locale = {}",
                locale.unwrap_or("")
            );
            // SAFETY: `cls` 是 SFSpeechRecognizer 类；`alloc` 得未初始化实例，
            // `initWithLocale:` 用有效 NSLocale 初始化，返回实例移交调用方（ARC 管理）。
            unsafe {
                let alloc: *mut AnyObject = msg_send![cls, alloc];
                msg_send![alloc, initWithLocale: ns_loc]
            }
        }
        None => {
            // SAFETY: 同上；`init` 用系统默认 locale。
            unsafe {
                let alloc: *mut AnyObject = msg_send![cls, alloc];
                msg_send![alloc, init]
            }
        }
    };
    if recognizer.is_null() {
        bail!("无法创建 SFSpeechRecognizer（当前语言可能不支持语音识别）");
    }
    Ok(recognizer)
}

/// `[NSLocale localeWithLocaleIdentifier:<id>]`。构造失败返回 None（调用方回退系统默认）。
fn ns_locale(identifier: &str) -> Option<*mut AnyObject> {
    let ns_id = ns_string_from_str(identifier).ok()?;
    let cls = AnyClass::get("NSLocale")?;
    // SAFETY: `cls` 是 NSLocale；`localeWithLocaleIdentifier:` 接收 NSString（`ns_id` 有效），
    // 返回 autoreleased NSLocale（在 spawn_blocking 线程的 autorelease 池存活）。
    let loc: *mut AnyObject = unsafe { msg_send![cls, localeWithLocaleIdentifier: ns_id] };
    if loc.is_null() {
        None
    } else {
        Some(loc)
    }
}

/// `[NSURL fileURLWithPath:<path>]`。
pub(super) fn file_url(path: &str) -> Result<*mut AnyObject> {
    let ns_path = ns_string_from_str(path)?;
    let cls = AnyClass::get("NSURL").ok_or_else(|| anyhow!("NSURL 类不可用"))?;
    // SAFETY: `cls` 是 NSURL；`fileURLWithPath:` 接收 NSString（`ns_path` 有效），
    // 返回 autoreleased NSURL（在 spawn_blocking 线程的隐式 autorelease 池存活）。
    let url: *mut AnyObject = unsafe { msg_send![cls, fileURLWithPath: ns_path] };
    if url.is_null() {
        bail!("构造文件 URL 失败: {path}");
    }
    Ok(url)
}

/// `[[SFSpeechURLRecognitionRequest alloc] initWithURL:<url>]`。
pub(super) fn create_url_request(url: *mut AnyObject) -> Result<*mut AnyObject> {
    let cls = AnyClass::get("SFSpeechURLRecognitionRequest")
        .ok_or_else(|| anyhow!("SFSpeechURLRecognitionRequest 类不可用"))?;
    // SAFETY: `cls` 是请求类；`alloc`+`initWithURL:` 用有效 `url` 初始化请求实例。
    let request: *mut AnyObject = unsafe {
        let alloc: *mut AnyObject = msg_send![cls, alloc];
        msg_send![alloc, initWithURL: url]
    };
    if request.is_null() {
        bail!("构造 SFSpeechURLRecognitionRequest 失败");
    }
    Ok(request)
}

/// `[NSString stringWithUTF8String:<bytes>]`。`s` 不能含内部 NUL。
fn ns_string_from_str(s: &str) -> Result<*mut AnyObject> {
    let c = std::ffi::CString::new(s).context("字符串含 NUL，无法构造 NSString")?;
    let cls = AnyClass::get("NSString").ok_or_else(|| anyhow!("NSString 类不可用"))?;
    // SAFETY: `cls` 是 NSString；`stringWithUTF8String:` 接收以 NUL 结尾的 C 字符串
    // （`c.as_ptr()` 在 `c` 存活期间有效，本调用同步完成，NSString 会拷贝内容）。
    let ns: *mut AnyObject = unsafe { msg_send![cls, stringWithUTF8String: c.as_ptr()] };
    if ns.is_null() {
        bail!("stringWithUTF8String 返回 nil");
    }
    Ok(ns)
}

/// NSString → Rust String（经 `UTF8String`）。nil 返回空串。
pub(super) fn ns_string_to_rust(ns: *mut AnyObject) -> String {
    if ns.is_null() {
        return String::new();
    }
    // SAFETY: `ns` 非空，是 NSString；`UTF8String` 返回指向 NSString 内部、以 NUL
    // 结尾的 UTF-8 缓冲，在自动释放池存活期间有效。立即拷贝成 owned String。
    let ptr: *const std::os::raw::c_char = unsafe { msg_send![ns, UTF8String] };
    if ptr.is_null() {
        return String::new();
    }
    // SAFETY: `ptr` 是有效、以 NUL 结尾的 C 字符串（来自 NSString.UTF8String）。
    unsafe { std::ffi::CStr::from_ptr(ptr) }
        .to_string_lossy()
        .into_owned()
}

/// NSError → 可读字符串（`localizedDescription`）。
pub(super) fn ns_error_description(error: *mut AnyObject) -> String {
    if error.is_null() {
        return "未知错误".to_string();
    }
    // SAFETY: `error` 非空，是 NSError；`localizedDescription` 返回 NSString。
    let desc: *mut AnyObject = unsafe { msg_send![error, localizedDescription] };
    let message = ns_string_to_rust(desc);
    if message.is_empty() {
        "未知错误".to_string()
    } else {
        message
    }
}
