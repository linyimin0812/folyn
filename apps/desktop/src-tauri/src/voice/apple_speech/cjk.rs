//! CJK 话段拼接纯函数群：判定相邻话段边界字符是否按无空格书写习惯连接。
//! 汉字、平假名、片假名及中日标点直接连接；其它脚本（包括韩文、俄文、阿文）补词间空格。

pub(super) fn should_join_without_space(prev: char, next: char) -> bool {
    (is_han_or_japanese(prev) && is_han_or_japanese(next))
        || (is_cjk_punctuation(prev) && is_han_or_japanese(next))
        || (is_han_or_japanese(prev) && is_cjk_punctuation(next))
        || is_opening_punctuation(prev)
        || is_closing_punctuation(next)
}

fn is_han_or_japanese(c: char) -> bool {
    matches!(
        c as u32,
        0x3400..=0x4DBF
            | 0x4E00..=0x9FFF
            | 0xF900..=0xFAFF
            | 0x20000..=0x2FA1F
            | 0x3040..=0x30FF
            | 0x31F0..=0x31FF
            | 0xFF66..=0xFF9D
    )
}

fn is_cjk_punctuation(c: char) -> bool {
    matches!(
        c,
        '、' | '。'
            | '，'
            | '！'
            | '？'
            | '：'
            | '；'
            | '「'
            | '」'
            | '『'
            | '』'
            | '【'
            | '】'
            | '《'
            | '》'
            | '〈'
            | '〉'
            | '・'
            | '〜'
            | '…'
            | '—'
    )
}

fn is_opening_punctuation(c: char) -> bool {
    matches!(
        c,
        '(' | '[' | '{' | '（' | '［' | '｛' | '「' | '『' | '【' | '《' | '〈'
    )
}

fn is_closing_punctuation(c: char) -> bool {
    matches!(
        c,
        ',' | '.'
            | '!'
            | '?'
            | ':'
            | ';'
            | ')'
            | ']'
            | '}'
            | '，'
            | '。'
            | '！'
            | '？'
            | '：'
            | '；'
            | '）'
            | '］'
            | '｝'
            | '、'
            | '」'
            | '』'
            | '】'
            | '》'
            | '〉'
    )
}
