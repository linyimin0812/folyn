//! 批处理识别 FFI 主体：授权、临时 wav、`recognitionTaskWithRequest` 同步化与轮询等待。

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::{anyhow, bail, Context, Result};
use block2::RcBlock;
use objc2::runtime::{AnyObject, Bool};
use objc2::msg_send;
use parking_lot::Mutex;

use super::lifecycle::{RecognitionDecision, RecognitionShared, extract_callback};
use super::objc::{create_recognizer, create_url_request, file_url, speech_recognizer_class};
use super::SendableTask;
use super::super::wav::encode_wav_16k_mono;

/// `SFSpeechRecognizerAuthorizationStatus`（NS_ENUM(NSInteger)）。
const SF_AUTH_NOT_DETERMINED: i64 = 0;
const SF_AUTH_DENIED: i64 = 1;
const SF_AUTH_RESTRICTED: i64 = 2;
const SF_AUTH_AUTHORIZED: i64 = 3;
const AUTHORIZATION_WAIT: Duration = Duration::from_secs(30);

/// 等待识别回调的兜底超时**下限**。识别本身另有 coordinator 侧动态超时；这里只防
/// block 永不回调导致线程永久阻塞。长录音按音频时长放大，见 `recognition_wait_budget`。
const RECOGNITION_WAIT: Duration = Duration::from_secs(60);
/// 识别等待的轮询步长。每轮之间检查 `cancel_flag` 与任务状态：取消 / 上层超时后阻塞
/// 线程最多再等这一步长（~100ms）就退出，而不是傻等满整个等待预算。
const RECOGNITION_POLL: Duration = Duration::from_millis(100);
/// `SFSpeechRecognitionTaskState`（NS_ENUM(NSInteger)）的 completed。任务终结
/// （成功、失败或取消）后进入该状态，是「不会再有回调」的权威信号。
const SF_TASK_STATE_COMPLETED: i64 = 4;
/// 识别引擎就绪（isAvailable）的轮询等待：刚 init 的 recognizer 常瞬时不可用（异步
/// 加载语言资源），稍等即就绪。等满仍不可用才报错——修「有时用不了」的竞态。
const AVAILABILITY_WAIT: Duration = Duration::from_secs(3);
const AVAILABILITY_POLL: Duration = Duration::from_millis(100);

/// 把 PCM 写成临时 wav，确保授权，跑批处理识别，删临时文件，返回结果。
/// 在 spawn_blocking 线程内同步执行。
pub(super) fn transcribe_pcm_blocking(
    pcm: &[u8],
    duration_ms: u64,
    locale: Option<&str>,
    cancel_flag: &AtomicBool,
    active_task: &Mutex<Option<SendableTask>>,
) -> Result<super::RawTranscript> {
    ensure_authorized()?;

    let samples: Vec<i16> = pcm
        .chunks_exact(2)
        .map(|chunk| i16::from_le_bytes([chunk[0], chunk[1]]))
        .collect();
    let wav = encode_wav_16k_mono(&samples);

    // 临时 wav：唯一文件名避免并发会话碰撞；用完即删（RAII guard）。
    let path = std::env::temp_dir().join(format!(
        "folyn-apple-speech-{}-{}.wav",
        std::process::id(),
        unique_suffix()
    ));
    std::fs::write(&path, &wav).with_context(|| format!("写临时 wav 失败: {}", path.display()))?;
    let _cleanup = TempFileGuard(&path);

    let path_str = path
        .to_str()
        .ok_or_else(|| anyhow!("临时 wav 路径含非 UTF-8 字符: {}", path.display()))?;
    let text = recognize_file(path_str, locale, duration_ms, cancel_flag, active_task)?;

    Ok(super::RawTranscript { text, duration_ms })
}

/// 当前授权未确定时弹系统授权框并等待；最终非 authorized 一律返回清晰错误。
///
/// pub 以便 `voice_start` 在录音启动前前置请求语音识别权限（issue: 权限在
/// 录完后才要），而不是等到 `voice_stop`→`transcribe()` 内才弹——后者让用户
/// 录完一整段才看到系统授权框。`transcribe` 内仍保留一次调用作为兜底（已授权
/// 时即时 Ok，无副作用）。
pub fn ensure_authorized() -> Result<()> {
    let cls = speech_recognizer_class()?;

    // SFSpeechRecognizer.authorizationStatus（类方法）。
    // SAFETY: `cls` 是已查到的 `SFSpeechRecognizer` 类对象；`authorizationStatus`
    // 是无参类方法，返回 NSInteger（i64）。
    let status: i64 = unsafe { msg_send![cls, authorizationStatus] };
    if status == SF_AUTH_AUTHORIZED {
        return Ok(());
    }
    if status == SF_AUTH_DENIED {
        bail!("语音识别权限被拒绝，请在 系统设置 → 隐私与安全性 → 语音识别 中允许 Folyn");
    }
    if status == SF_AUTH_RESTRICTED {
        bail!("此设备的语音识别功能受限（可能由家长控制或 MDM 策略禁用）");
    }
    if status != SF_AUTH_NOT_DETERMINED {
        bail!("语音识别授权状态未知: {status}");
    }

    // NotDetermined：弹系统授权框并同步等待回调。block 范式照抄 permissions.rs。
    let (tx, rx) = mpsc::channel();
    let block = RcBlock::new(move |granted_status: i64| {
        let _ = tx.send(granted_status);
    });
    log::info!("[apple-speech] requesting SFSpeechRecognizer authorization");
    // SAFETY: `requestAuthorization:` 接收一个 `void(^)(SFSpeechRecognizerAuthorizationStatus)`
    // block，回调参数是 NSInteger（i64）。`&*block` 是 block2 的稳定指针，block 本体
    // 由 `block` 持有到本作用域结束 —— 回调在系统弹框被用户应答后触发，发生在
    // `rx.recv_timeout` 返回之前，因此 block 生命周期足够覆盖回调。
    let _: () = unsafe { msg_send![cls, requestAuthorization: &*block] };

    let granted = match rx.recv_timeout(AUTHORIZATION_WAIT) {
        Ok(s) => s,
        Err(err) => bail!("等待语音识别授权超时或失败: {err}"),
    };
    match granted {
        SF_AUTH_AUTHORIZED => Ok(()),
        SF_AUTH_DENIED => {
            bail!("语音识别权限被拒绝，请在 系统设置 → 隐私与安全性 → 语音识别 中允许 Folyn")
        }
        SF_AUTH_RESTRICTED => bail!("此设备的语音识别功能受限"),
        other => bail!("语音识别未获授权（状态 {other}）"),
    }
}

/// 用 `SFSpeechURLRecognitionRequest` 对给定 wav 文件做一次批处理识别，
/// 把 `recognitionTaskWithRequest:resultHandler:` 的异步回调同步化。
///
/// **多话段累积（修「停顿后前文丢失」）**：设备端识别会在语音停顿处把音频切成多个
/// 话段（utterance），逐话段回调、逐话段重置文本（见 `SegmentAccumulator` 文档）。
/// 因此不能「见到第一个 isFinal 就收工」——resultHandler 只负责把每次回调喂进
/// `SegmentAccumulator`；等待循环以 `task.state == completed`（辅以 isFinal 后静默
/// 的后备条件）判定识别真正结束，再把所有话段拼接返回。
///
/// 等待是每 `RECOGNITION_POLL` 一轮的轮询：每轮检查 `cancel_flag`，置位则 `cancel`
/// 底层任务并返回「已取消」错误，让上层动态超时抛弃 / `cancel()` 触发时阻塞线程在
/// ~100ms 内退出。返回前无论成败都清空 `active_task`（RAII guard 兜底 `?` 早退）。
fn recognize_file(
    wav_path: &str,
    locale: Option<&str>,
    duration_ms: u64,
    cancel_flag: &AtomicBool,
    active_task: &Mutex<Option<SendableTask>>,
) -> Result<String> {
    let recognizer = create_recognizer(locale)?;

    // 识别引擎就绪等待（isAvailable 竞态）：SFSpeechRecognizer 刚 init 时引擎往往还没
    // 就绪（异步加载语言资源），isAvailable 瞬时为 false、稍等即 true。之前一见 false
    // 就 bail —— 这正是「有时用不了」的主因。改为轮询等待最多几秒再判定。
    wait_until_available(recognizer)?;

    let url = file_url(wav_path)?;
    let request = create_url_request(url)?;

    // on-device 优先：设备支持当前语言的设备端识别就强制 on-device —— 音频不出本机
    // （隐私）、离线可用、不受网络波动/限流影响（消除「有时连不上服务器」）。不支持的
    // 语言回退系统默认（可能走网络）以保底能用。
    configure_on_device(recognizer, request);

    // 显式开启 partial 回调：话段边界信号（speechRecognitionMetadata 非空的结果）
    // 出现在非 final 回调里，关掉 partial 就拿不到边界、无从累积。
    // SAFETY: `request` 是 SFSpeechURLRecognitionRequest（父类提供该 BOOL setter）。
    let _: () = unsafe { msg_send![request, setShouldReportPartialResults: Bool::new(true)] };

    let shared = Arc::new(Mutex::new(RecognitionShared::default()));
    let shared_cb = Arc::clone(&shared);
    // resultHandler: void(^)(SFSpeechRecognitionResult *result, NSError *error)。
    // 回调只做「解包 + 喂累积器」，结束判定完全交给下面的等待循环。
    let block = RcBlock::new(move |result: *mut AnyObject, error: *mut AnyObject| {
        let (recognized, callback_error) = extract_callback(result, error);
        let mut s = shared_cb.lock();
        s.record_callback(recognized, callback_error, Instant::now());
    });

    log::info!("[apple-speech] starting recognitionTaskWithRequest");
    // SAFETY: `recognizer` 有效；`request` 是有效的 `SFSpeechURLRecognitionRequest`；
    // `&*block` 是稳定 block 指针，block 本体被 `block` 持有至本作用域结束。
    // 返回的 `SFSpeechRecognitionTask` 自身被 recognizer 强引用直到完成；我们额外把
    // 句柄存进 `active_task` 供 `cancel()` 从别的线程终止它（见 SendableTask 文档）。
    let task: *mut AnyObject = unsafe {
        msg_send![
            recognizer,
            recognitionTaskWithRequest: request,
            resultHandler: &*block
        ]
    };

    // 存句柄供 cancel()；guard 保证本函数任意退出路径都把它清回 None，避免悬挂。
    *active_task.lock() = Some(SendableTask(task));
    let _task_guard = ActiveTaskGuard(active_task);

    // 轮询等待：每轮先查 cancel_flag，再看错误 / 终止条件；超过按音频时长放大的
    // 等待预算则超时（外层 coordinator 的动态超时通常先于它触发，这里只防回调失联）。
    let deadline = Instant::now() + recognition_wait_budget(duration_ms);
    loop {
        let now = Instant::now();
        let mut s = shared.lock();
        let decision = s.lifecycle.decide(
            now,
            cancel_flag.load(Ordering::SeqCst),
            s.error.is_some(),
            now >= deadline,
        );
        match decision {
            RecognitionDecision::Cancel => {
                drop(s);
                // 若 cancel() 尚未取走句柄（例如超时路径只置了 flag 没调 cancel），这里
                // 补发一次 cancel，确保底层识别任务被真正终止，而不是留它在后台跑满。
                if let Some(t) = active_task.lock().take() {
                    // SAFETY: 见 SendableTask 文档 —— `cancel` 无参、可跨线程调用，仅调用不解引用。
                    let _: () = unsafe { msg_send![t.0, cancel] };
                }
                bail!("语音识别已取消");
            }
            RecognitionDecision::Error => {
                let Some(err) = s.error.take() else {
                    bail!("语音识别失败：终止状态缺少错误详情");
                };
                // result 与 error 同次到达时，record_callback 已先折叠 result；这里抢救只
                // 收账一次，不会因错误回放已提交的 final。
                let salvaged = s.acc.salvage();
                if salvaged.is_empty() {
                    bail!("语音识别失败: {err}");
                }
                log::warn!(
                    "[apple-speech] recognition error after {} segment(s); returning salvaged text: {err}",
                    s.acc.segment_count()
                );
                return Ok(salvaged);
            }
            RecognitionDecision::Finish => {
                let text = s.acc.salvage();
                log::info!(
                    "[apple-speech] recognition finished: {} segment(s), {} chars",
                    s.acc.segment_count(),
                    text.chars().count()
                );
                return Ok(text);
            }
            RecognitionDecision::Timeout => bail!("等待语音识别结果超时"),
            RecognitionDecision::Wait => drop(s),
        }

        std::thread::sleep(RECOGNITION_POLL);
        // SAFETY: `task` 在本栈帧内被 recognizer 强引用存活（见上）；`state` 是无参
        // 只读属性，返回 NSInteger（i64）。跨线程读一个整型属性，最坏读到瞬时旧值，
        // 下一轮（~100ms 后）即追上，不影响正确性。
        let state: i64 = unsafe { msg_send![task, state] };
        if state == SF_TASK_STATE_COMPLETED {
            shared.lock().lifecycle.record_completed(Instant::now());
        }
    }
}

/// 识别等待预算：音频时长 + 30s，且不低于 `RECOGNITION_WAIT`。批处理识别通常远快于
/// 实时，但长录音（多话段逐段吐结果）不该被固定 60s 硬顶截断——旧实现对超过 60s
/// 才识别完的长录音会直接报「等待超时」。外层 coordinator 的动态超时仍然先兜底。
fn recognition_wait_budget(duration_ms: u64) -> Duration {
    RECOGNITION_WAIT.max(Duration::from_millis(duration_ms).saturating_add(Duration::from_secs(30)))
}

/// 保证 `recognize_file` 任意退出路径（含 `?` 早退、正常返回、取消/超时）都把
/// `active_task` 清回 `None`，避免悬挂的 task 句柄被后续 `cancel()` 误用。
struct ActiveTaskGuard<'a>(&'a Mutex<Option<SendableTask>>);

impl Drop for ActiveTaskGuard<'_> {
    fn drop(&mut self) {
        *self.0.lock() = None;
    }
}

/// 轮询等待识别引擎就绪。init 后 isAvailable 可能瞬时 false（异步加载资源），稍等
/// 即 true；等满 AVAILABILITY_WAIT 仍不可用才报错并引导。
fn wait_until_available(recognizer: *mut AnyObject) -> Result<()> {
    let deadline = std::time::Instant::now() + AVAILABILITY_WAIT;
    loop {
        // SAFETY: `recognizer` 有效；`isAvailable` 无参返回 BOOL。
        let available: Bool = unsafe { msg_send![recognizer, isAvailable] };
        if available.as_bool() {
            return Ok(());
        }
        if std::time::Instant::now() >= deadline {
            bail!(
                "当前语言的语音识别暂不可用：系统可能仍在准备识别资源，或需在 系统设置 → 键盘 → 听写 中下载对应语言。可稍后重试，或改用其它 ASR。"
            );
        }
        std::thread::sleep(AVAILABILITY_POLL);
    }
}

/// 支持设备端识别的语言就把请求设成强制 on-device（音频不出本机、离线可用）；不支持
/// 的语言不设，回退系统默认（可能走网络）以保底能用。
fn configure_on_device(recognizer: *mut AnyObject, request: *mut AnyObject) {
    // SFSpeechRecognizer.supportsOnDeviceRecognition（macOS 10.15+，BOOL 属性）。
    // SAFETY: `recognizer` 有效；无参返回 BOOL。
    let supports: Bool = unsafe { msg_send![recognizer, supportsOnDeviceRecognition] };
    if supports.as_bool() {
        // SFSpeechRecognitionRequest.requiresOnDeviceRecognition = YES。
        // SAFETY: `request` 是 SFSpeechURLRecognitionRequest（父类
        // SFSpeechRecognitionRequest 提供该 setter）；参数 BOOL。
        let _: () = unsafe { msg_send![request, setRequiresOnDeviceRecognition: Bool::new(true)] };
        log::info!("[apple-speech] on-device recognition enabled");
    } else {
        log::info!(
            "[apple-speech] on-device unsupported for current locale; using default (may use network)"
        );
    }
}

/// 进程内单调递增后缀，避免同进程内并发临时 wav 文件名碰撞。
fn unique_suffix() -> u64 {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    COUNTER.fetch_add(1, Ordering::Relaxed)
}

/// 临时文件 RAII 清理：transcribe 返回（成功或失败）时删除 wav。
struct TempFileGuard<'a>(&'a std::path::Path);

impl Drop for TempFileGuard<'_> {
    fn drop(&mut self) {
        if let Err(err) = std::fs::remove_file(self.0) {
            log::warn!(
                "[apple-speech] 删除临时 wav 失败 {}: {err}",
                self.0.display()
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn temp_file_guard_removes_file_on_drop() {
        let path = std::env::temp_dir().join(format!(
            "folyn-apple-speech-test-{}.wav",
            unique_suffix()
        ));
        std::fs::write(&path, b"x").unwrap();
        assert!(path.exists());
        {
            let _guard = TempFileGuard(&path);
        }
        assert!(!path.exists());
    }

    #[test]
    fn unique_suffix_is_monotonic() {
        let a = unique_suffix();
        let b = unique_suffix();
        assert!(b > a);
    }

    #[test]
    fn active_task_guard_clears_handle_on_drop() {
        // active_task 存了句柄后，ActiveTaskGuard 掉出作用域应把它清回 None。
        // 用 dangling 指针仅做占位：guard 的 Drop 只 take + 置 None，不触碰指针内容。
        let slot: Mutex<Option<SendableTask>> = Mutex::new(None);
        *slot.lock() = Some(SendableTask(std::ptr::null_mut()));
        assert!(slot.lock().is_some());
        {
            let _guard = ActiveTaskGuard(&slot);
        }
        assert!(
            slot.lock().is_none(),
            "ActiveTaskGuard drop 后 active_task 必须清空，避免悬挂句柄"
        );
    }

    #[test]
    fn recognition_wait_budget_scales_with_audio_length() {
        // 短音频维持 60s 下限；长音频按时长 + 30s 放大，不再被固定硬顶截断。
        assert_eq!(recognition_wait_budget(5_000), RECOGNITION_WAIT);
        assert_eq!(recognition_wait_budget(300_000), Duration::from_secs(330));
    }
}
