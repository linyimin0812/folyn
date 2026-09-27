//! 识别生命周期：resultHandler 回调与等待循环之间的共享状态、终止判定与回调解包。

use std::time::{Duration, Instant};

use objc2::runtime::{AnyObject, Bool};
use objc2::{msg_send, sel};

use super::objc::{ns_error_description, ns_string_to_rust};
use super::segment::SegmentAccumulator;

/// 观察到任务 completed 后再等这一小段，让已经在飞的最后一次 resultHandler 回调
/// 落进累积器，避免「state 先翻转、回调后到」的竞态把最后一个话段截掉。
const COMPLETION_GRACE: Duration = Duration::from_millis(250);
/// 后备终止条件：已见 isFinal 且此后静默这么久，视为识别结束。只防 `state` 轮询
/// 因系统差异拿不到 completed 时无限等待；正常路径由 completed + COMPLETION_GRACE
/// 快速收账，不受此值影响。取 5s 是因为多话段场景 isFinal 可能逐话段出现，话段间
/// 的回调空窗（对应音频里的长停顿）必须远小于该阈值，否则会提前收账截掉后文——
/// 批处理识别消化静音远快于实时，5s 空窗足够安全。
const FINAL_QUIESCENCE: Duration = Duration::from_secs(5);

/// resultHandler 回调与等待循环之间的共享状态（block 侧写，轮询侧读）。
#[derive(Default)]
pub(super) struct RecognitionShared {
    pub(super) acc: SegmentAccumulator,
    pub(super) lifecycle: RecognitionLifecycle,
    /// 第一个识别错误（保留首个，后续忽略）。
    pub(super) error: Option<String>,
}

pub(super) struct RecognizedCallback {
    pub(super) text: String,
    /// 本次结果带 `speechRecognitionMetadata`（非空）——一个话段（utterance）
    /// 到此结束，`text` 是该话段的完整文本。
    pub(super) utterance_ended: bool,
    pub(super) is_final: bool,
}

impl RecognitionShared {
    pub(super) fn record_callback(
        &mut self,
        recognized: Option<RecognizedCallback>,
        error: Option<String>,
        at: Instant,
    ) {
        if let Some(result) = recognized {
            if result.utterance_ended {
                log::info!(
                    "[apple-speech] utterance boundary: segment captured ({} chars)",
                    result.text.chars().count()
                );
            }
            self.acc
                .fold(&result.text, result.utterance_ended, result.is_final);
            self.lifecycle.record_callback(at, result.is_final);
        }
        if self.error.is_none() {
            self.error = error;
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum RecognitionDecision {
    Wait,
    Finish,
    Cancel,
    Error,
    Timeout,
}

#[derive(Default)]
pub(super) struct RecognitionLifecycle {
    completed_at: Option<Instant>,
    last_callback_at: Option<Instant>,
    saw_final: bool,
}

impl RecognitionLifecycle {
    fn record_callback(&mut self, at: Instant, is_final: bool) {
        self.last_callback_at = Some(at);
        self.saw_final |= is_final;
    }

    pub(super) fn record_completed(&mut self, at: Instant) {
        self.completed_at.get_or_insert(at);
    }

    pub(super) fn decide(
        &self,
        now: Instant,
        cancelled: bool,
        has_error: bool,
        deadline_reached: bool,
    ) -> RecognitionDecision {
        if cancelled {
            return RecognitionDecision::Cancel;
        }
        if has_error {
            return RecognitionDecision::Error;
        }

        let completion_settled = self
            .completed_at
            .map(|at| now.saturating_duration_since(at) >= COMPLETION_GRACE)
            .unwrap_or(false)
            && self
                .last_callback_at
                .map(|at| now.saturating_duration_since(at) >= COMPLETION_GRACE)
                .unwrap_or(true);
        let final_quiesced = self.saw_final
            && self
                .last_callback_at
                .map(|at| now.saturating_duration_since(at) >= FINAL_QUIESCENCE)
                .unwrap_or(false);
        if completion_settled || final_quiesced {
            return RecognitionDecision::Finish;
        }
        if deadline_reached {
            return RecognitionDecision::Timeout;
        }
        RecognitionDecision::Wait
    }
}

/// 从 `(result, error)` 同时解包识别结果与错误。Apple 允许二者同次出现；调用方必须先
/// 折叠结果、再记录错误，确保错误抢救包含这次最后文本且只收账一次。
pub(super) fn extract_callback(
    result: *mut AnyObject,
    error: *mut AnyObject,
) -> (Option<RecognizedCallback>, Option<String>) {
    let callback_error = if !error.is_null() {
        Some(ns_error_description(error))
    } else if result.is_null() {
        Some("识别返回空结果".to_string())
    } else {
        None
    };
    if result.is_null() {
        return (None, callback_error);
    }
    // SAFETY: `result` 非空，是 `SFSpeechRecognitionResult`；`isFinal` 无参返回 BOOL。
    let is_final: Bool = unsafe { msg_send![result, isFinal] };
    // speechRecognitionMetadata 非空 = 一个话段结束（macOS 11.3+）。老系统没有该
    // selector，先 respondsToSelector 探测，避免直接调用未知 selector 崩溃。
    // SAFETY: `respondsToSelector:` 是 NSObject 协议方法，参数为 Sel，返回 BOOL。
    let has_metadata_sel: Bool =
        unsafe { msg_send![result, respondsToSelector: sel!(speechRecognitionMetadata)] };
    let utterance_ended = if has_metadata_sel.as_bool() {
        // SAFETY: 上面已确认 selector 存在；无参返回对象指针（可能为 nil）。
        let metadata: *mut AnyObject = unsafe { msg_send![result, speechRecognitionMetadata] };
        !metadata.is_null()
    } else {
        false
    };
    // result.bestTranscription.formattedString → NSString → Rust String。
    // SAFETY: `result` 非空；`bestTranscription` 返回 SFTranscription（可能为 nil），
    // `formattedString` 返回 NSString。
    let transcription: *mut AnyObject = unsafe { msg_send![result, bestTranscription] };
    let text = if transcription.is_null() {
        String::new()
    } else {
        let formatted: *mut AnyObject = unsafe { msg_send![transcription, formattedString] };
        ns_string_to_rust(formatted)
    };
    let recognized = RecognizedCallback {
        text,
        utterance_ended,
        is_final: is_final.as_bool(),
    };
    (Some(recognized), callback_error)
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---- RecognitionLifecycle：完成 / 迟到回调 / 静默与终止优先级 ----

    #[test]
    fn completed_task_waits_for_the_full_grace_period() {
        let start = Instant::now();
        let mut lifecycle = RecognitionLifecycle::default();
        lifecycle.record_completed(start);

        assert_eq!(
            lifecycle.decide(
                start + COMPLETION_GRACE - Duration::from_millis(1),
                false,
                false,
                false
            ),
            RecognitionDecision::Wait
        );
        assert_eq!(
            lifecycle.decide(start + COMPLETION_GRACE, false, false, false),
            RecognitionDecision::Finish
        );
    }

    #[test]
    fn callback_after_completed_restarts_the_grace_window() {
        let start = Instant::now();
        let late = start + Duration::from_millis(200);
        let mut lifecycle = RecognitionLifecycle::default();
        lifecycle.record_completed(start);
        lifecycle.record_callback(late, false);

        assert_eq!(
            lifecycle.decide(
                late + COMPLETION_GRACE - Duration::from_millis(1),
                false,
                false,
                false
            ),
            RecognitionDecision::Wait
        );
        assert_eq!(
            lifecycle.decide(late + COMPLETION_GRACE, false, false, false),
            RecognitionDecision::Finish
        );
    }

    #[test]
    fn final_callback_without_completed_uses_silent_fallback() {
        let start = Instant::now();
        let mut lifecycle = RecognitionLifecycle::default();
        lifecycle.record_callback(start, true);

        assert_eq!(
            lifecycle.decide(
                start + FINAL_QUIESCENCE - Duration::from_millis(1),
                false,
                false,
                false
            ),
            RecognitionDecision::Wait
        );
        assert_eq!(
            lifecycle.decide(start + FINAL_QUIESCENCE, false, false, false),
            RecognitionDecision::Finish
        );
    }

    #[test]
    fn cancellation_wins_over_error_timeout_and_completion() {
        let start = Instant::now();
        let mut lifecycle = RecognitionLifecycle::default();
        lifecycle.record_completed(start);
        assert_eq!(
            lifecycle.decide(start + COMPLETION_GRACE, true, true, true),
            RecognitionDecision::Cancel
        );
    }

    #[test]
    fn error_wins_over_timeout_and_completion_when_not_cancelled() {
        let start = Instant::now();
        let mut lifecycle = RecognitionLifecycle::default();
        lifecycle.record_completed(start);
        assert_eq!(
            lifecycle.decide(start + COMPLETION_GRACE, false, true, true),
            RecognitionDecision::Error
        );
    }

    #[test]
    fn result_and_error_in_one_callback_salvages_the_result_once() {
        let start = Instant::now();
        let mut shared = RecognitionShared::default();
        shared.record_callback(
            Some(RecognizedCallback {
                text: "已经识别的内容".to_string(),
                utterance_ended: false,
                is_final: true,
            }),
            Some("尾部错误".to_string()),
            start,
        );

        assert_eq!(
            shared
                .lifecycle
                .decide(start, false, shared.error.is_some(), false),
            RecognitionDecision::Error
        );
        assert_eq!(shared.acc.salvage(), "已经识别的内容");
        assert_eq!(shared.acc.salvage(), "已经识别的内容");
    }

    #[test]
    fn settled_completion_wins_over_timeout_but_timeout_ends_plain_waiting() {
        let start = Instant::now();
        let mut completed = RecognitionLifecycle::default();
        completed.record_completed(start);
        assert_eq!(
            completed.decide(start + COMPLETION_GRACE, false, false, true),
            RecognitionDecision::Finish
        );

        assert_eq!(
            RecognitionLifecycle::default().decide(start, false, false, true),
            RecognitionDecision::Timeout
        );
    }
}
