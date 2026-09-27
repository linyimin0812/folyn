//! 跨话段累积识别文本（修「停顿后前文丢失」，issue：Apple Speech 停顿截断）。
//!
//! Apple 设备端识别（`requiresOnDeviceRecognition`）会在语音停顿处把音频切成多个
//! 「话段」(utterance)：每个话段结束时回调一次带 `speechRecognitionMetadata` 的结果
//! （其文本**只覆盖该话段**），随后 partial 文本从空重新累计；`isFinal` 通常只在最后
//! 一个话段出现（个别系统版本按话段多次 isFinal）。旧实现只取第一个 isFinal 的文本，
//! 停顿之前的所有话段被整段丢弃——这正是「说话中间停顿思考，前面内容全没了」的根因。
//! 这里把每个话段落袋，识别结束时按 CJK 规则拼接返回。
//!
//! 云端（服务器）识别没有话段重置：partial 全程累计、final 为全文。此时 `segments`
//! 只会收到一条 final 全文（或经前缀替换归并），行为与旧实现一致。

use super::cjk::should_join_without_space;

#[derive(Default)]
pub(super) struct SegmentAccumulator {
    /// 已结束话段的文本，按时间顺序。
    segments: Vec<String>,
    /// 当前话段最新 partial 文本。
    current: String,
    /// 自上次明确边界提交后，是否见过新一代 partial。它把「下一话段」与同一任务在
    /// 结尾重放 final 全文区分开，避免用跨话段文本前缀猜测身份。
    current_generation_active: bool,
    /// 最近一次 metadata 边界提交后，任务可能在完成时重放的累计全文。只有明确边界
    /// 才能创建这个候选；纯 isFinal 序列即使文本相同也必须视为独立话段。
    cumulative_replay_candidate: Option<String>,
}

impl SegmentAccumulator {
    /// 喂入一次识别回调。`utterance_ended` / `is_final` 的文本视为所在话段的完整
    /// 文本并落袋；普通 partial 只更新 `current`，除非检测到「静默重置」。
    pub(super) fn fold(&mut self, text: &str, utterance_ended: bool, is_final: bool) {
        if utterance_ended {
            // metadata 是 Apple 给出的独立 utterance 证据；即使相邻文本相同或互为
            // 前缀也必须分别提交，不能把正常复述/自我修正当累计回放吞掉。
            let segment = if text.trim().is_empty() {
                std::mem::take(&mut self.current)
            } else {
                text.to_string()
            };
            self.push_segment(&segment);
            self.current.clear();
            self.current_generation_active = false;
            self.cumulative_replay_candidate = Some(normalized(&self.joined()));
        } else if is_final {
            let segment = if text.trim().is_empty() {
                std::mem::take(&mut self.current)
            } else {
                text.to_string()
            };
            // 只有 metadata 边界创建的快照能证明这是同一 task 的累计全文重放；不能仅
            // 因 final 文本等于 joined 就去重，否则连续两个相同的 final-only 话段会丢失。
            let normalized_segment = normalized(&segment);
            let is_cumulative_replay = !self.current_generation_active
                && self.cumulative_replay_candidate.as_deref() == Some(normalized_segment.as_str());
            if !is_cumulative_replay {
                self.push_segment(&segment);
                self.cumulative_replay_candidate = None;
            }
            self.current.clear();
            self.current_generation_active = false;
        } else if self.reset_detected(text) {
            // 防守路径：没有 metadata 边界回调、partial 却骤缩——设备端识别已悄悄
            // 重开话段。把上一话段已见的最长 partial 先落袋，再从新文本重新累计。
            let previous = std::mem::take(&mut self.current);
            self.push_segment(&previous);
            self.current = text.to_string();
            self.current_generation_active = true;
            self.cumulative_replay_candidate = None;
        } else {
            self.current = text.to_string();
            self.current_generation_active = true;
            self.cumulative_replay_candidate = None;
        }
    }

    /// partial 骤缩视为话段重置。阈值保守（原文本 ≥12 字符且新文本缩到 1/3 以下）：
    /// 识别器正常的假设修正只会小幅增删，不会缩水到这个程度。
    fn reset_detected(&self, text: &str) -> bool {
        let current_chars = self.current.chars().count();
        let new_chars = text.chars().count();
        current_chars >= 12 && new_chars.saturating_mul(3) < current_chars
    }

    /// 明确话段落袋。调用方先依据 metadata / generation / final 状态判定提交身份；此处
    /// 不做跨话段文本启发式去重，避免吞掉正常复述与前缀式自我修正。
    fn push_segment(&mut self, text: &str) {
        let trimmed = text.trim();
        if trimmed.is_empty() {
            return;
        }
        self.segments.push(trimmed.to_string());
    }

    /// 结束收账：把残余 partial 落袋后返回全部话段的拼接文本。
    pub(super) fn salvage(&mut self) -> String {
        if self.current_generation_active {
            let current = std::mem::take(&mut self.current);
            self.push_segment(&current);
            self.current_generation_active = false;
        }
        self.joined()
    }

    pub(super) fn segment_count(&self) -> usize {
        self.segments.len()
    }

    /// 话段拼接：汉字、平假名、片假名及中日标点按无空格书写习惯连接；其它脚本
    /// （包括韩文、俄文、阿文）默认补词间空格。润色模式下 LLM 仍会再整理。
    fn joined(&self) -> String {
        let mut out = String::new();
        for segment in &self.segments {
            if out.is_empty() {
                out.push_str(segment);
                continue;
            }
            let join_bare = matches!(
                (out.chars().last(), segment.chars().next()),
                (Some(prev), Some(next)) if should_join_without_space(prev, next)
            );
            if !join_bare {
                out.push(' ');
            }
            out.push_str(segment);
        }
        out
    }
}

/// 空白不敏感比较用：剔除所有空白字符。话段拼接与引擎全文重放的分隔符可能不同
/// （我们按 CJK 规则拼、引擎按自己的习惯拼），只比内容不比空白。
fn normalized(s: &str) -> String {
    s.chars().filter(|c| !c.is_whitespace()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn server_style_growing_partials_keep_full_final() {
        // 云端识别：partial 全程累计、final 为全文 —— 行为必须与旧实现一致。
        let mut acc = SegmentAccumulator::default();
        acc.fold("hello", false, false);
        acc.fold("hello there", false, false);
        acc.fold("hello there how are you", false, true);
        assert_eq!(acc.salvage(), "hello there how are you");
    }

    #[test]
    fn on_device_pause_segments_are_all_kept() {
        // 用户 bug 复现：停顿产生话段边界（metadata），旧实现只留最后一段。
        let mut acc = SegmentAccumulator::default();
        acc.fold("今天天气", false, false);
        acc.fold("今天天气很好", true, false); // 停顿 → 话段 1 结束
        acc.fold("我们", false, false); // partial 从空重来
        acc.fold("我们去公园", false, true); // 最后话段以 isFinal 收尾
        assert_eq!(acc.salvage(), "今天天气很好我们去公园");
    }

    #[test]
    fn per_segment_finals_are_all_kept() {
        // 个别系统按话段多次 isFinal：每个 final 都要落袋，不能见到第一个就收工。
        let mut acc = SegmentAccumulator::default();
        acc.fold("第一段内容", false, true);
        acc.fold("第二段内容", false, true);
        assert_eq!(acc.salvage(), "第一段内容第二段内容");
    }

    #[test]
    fn repeated_per_segment_finals_are_distinct_utterances() {
        // 两个相邻话段内容可以完全相同；不能把第二个 final 当任务级全文重放吞掉。
        let mut acc = SegmentAccumulator::default();
        acc.fold("hello", false, true);
        acc.fold("hello", false, true);
        assert_eq!(acc.salvage(), "hello hello");
    }

    #[test]
    fn silent_reset_without_metadata_is_salvaged() {
        // 防守路径：没有 metadata 边界、partial 骤缩 → 上一话段先落袋。
        let mut acc = SegmentAccumulator::default();
        acc.fold("这是停顿之前说的很长一段话啊", false, false); // 14 字符
        acc.fold("后", false, false); // 骤缩 → 判定重置
        acc.fold("后半段", false, true);
        assert_eq!(acc.salvage(), "这是停顿之前说的很长一段话啊后半段");
    }

    #[test]
    fn small_revision_is_not_treated_as_reset() {
        // 识别器正常的假设修正（小幅缩短）不能触发重置，否则会人为造出重复段。
        let mut acc = SegmentAccumulator::default();
        acc.fold("hello there my friend", false, false);
        acc.fold("hello there my frien", false, false); // 仅缩 1 字符
        acc.fold("hello there my friends", false, true);
        assert_eq!(acc.salvage(), "hello there my friends");
    }

    #[test]
    fn equal_boundary_segments_are_distinct_utterances() {
        let mut acc = SegmentAccumulator::default();
        acc.fold("hello", true, false);
        acc.fold("hello", true, false);
        assert_eq!(acc.salvage(), "hello hello");
    }

    #[test]
    fn longer_prefix_boundary_segment_is_not_a_cumulative_replay() {
        let mut acc = SegmentAccumulator::default();
        acc.fold("好的", true, false);
        acc.fold("好的我们继续", true, false);
        assert_eq!(acc.salvage(), "好的好的我们继续");
    }

    #[test]
    fn shorter_prefix_boundary_segment_is_not_a_cumulative_replay() {
        let mut acc = SegmentAccumulator::default();
        acc.fold("好的我们继续", true, false);
        acc.fold("好的", true, false);
        assert_eq!(acc.salvage(), "好的我们继续好的");
    }

    #[test]
    fn full_text_replay_at_final_is_not_duplicated() {
        // 防守：逐话段落袋之后，final 若重放「累计全文」（分隔符可能与我们不同），
        // 空白不敏感去重必须把它忽略，不得把全文再拼一遍。
        let mut acc = SegmentAccumulator::default();
        acc.fold("今天天气很好", true, false);
        acc.fold("我们去公园", true, false);
        acc.fold("今天天气很好 我们去公园", false, true);
        assert_eq!(acc.salvage(), "今天天气很好我们去公园");
    }

    #[test]
    fn empty_boundary_text_falls_back_to_partial() {
        // 边界结果偶见空文本：兜底用当前话段已见的最长 partial，不丢内容。
        let mut acc = SegmentAccumulator::default();
        acc.fold("前半句", false, false);
        acc.fold("", true, false);
        acc.fold("后半句", false, true);
        assert_eq!(acc.salvage(), "前半句后半句");
    }

    #[test]
    fn salvage_includes_residual_partial() {
        // 错误兜底路径：final 没等到，也要把已见 partial 抢救回来。
        let mut acc = SegmentAccumulator::default();
        acc.fold("说到一半", false, false);
        assert_eq!(acc.salvage(), "说到一半");
    }

    #[test]
    fn ascii_segments_join_with_space_cjk_join_bare() {
        let mut acc = SegmentAccumulator::default();
        acc.fold("first part", true, false);
        acc.fold("second part", true, false);
        assert_eq!(acc.salvage(), "first part second part");

        let mut mixed = SegmentAccumulator::default();
        mixed.fold("中文段落", true, false);
        mixed.fold("english tail", true, false);
        assert_eq!(mixed.salvage(), "中文段落 english tail");
    }

    #[test]
    fn non_cjk_non_ascii_segments_keep_word_spaces() {
        for (first, second, expected) in [
            ("привет", "мир", "привет мир"),
            ("مرحبا", "بالعالم", "مرحبا بالعالم"),
            ("안녕", "하세요", "안녕 하세요"),
        ] {
            let mut acc = SegmentAccumulator::default();
            acc.fold(first, true, false);
            acc.fold(second, true, false);
            assert_eq!(acc.salvage(), expected);
        }
    }

    #[test]
    fn chinese_and_japanese_scripts_join_without_spaces_around_native_punctuation() {
        let mut chinese = SegmentAccumulator::default();
        chinese.fold("你好，", true, false);
        chinese.fold("我们继续", true, false);
        assert_eq!(chinese.salvage(), "你好，我们继续");

        let mut japanese = SegmentAccumulator::default();
        japanese.fold("今日は", true, false);
        japanese.fold("晴れです。", true, false);
        assert_eq!(japanese.salvage(), "今日は晴れです。");
    }
}
