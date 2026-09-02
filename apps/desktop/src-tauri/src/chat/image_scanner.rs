//! Inline-image scanner for the chat stream.
//!
//! State machine that scans an incoming stream of Text deltas for inline
//! `data:image/<mt>;base64,<...>` data URLs and emits them as
//! `ScanEvent::Image` instead of letting raw base64 flow through as
//! `ScanEvent::Delta`. Outside the data URL, text passes through as Delta
//! unchanged.
//!
//! Why a state machine: image-generation models return the rendered image as
//! a single text delta (or a continuous run of deltas) containing a data URL.
//! Without scanning, the frontend's markdown pipeline renders the base64 as a
//! giant opaque text blob. The scanner emits a structured `Image` event per
//! complete data URL, so the frontend renders `<img>` directly. Partial data
//! URL prefixes that span delta boundaries are held back until they complete
//! or are disproven.
//!
//! ponytail: scanning happens in Rust, not TS, so the frontend stays dumb
//! (render events as they arrive). The cost is one state machine here, but
//! it replaces an O(n²) per-delta rescan on the TS side. The lazy shortcut
//! would be a regex-per-delta over the accumulated text; the state machine
//! avoids the O(n²) reparse without giving up cross-delta prefix detection.
//!
//! Pure module: no chat/rig/Tauri dependencies — only string scanning. This
//! lets it be unit-tested in isolation (see `chat.rs > mod tests`).

#[derive(Default)]
pub(crate) struct ImageScanner {
    state: ScanState,
    /// Text held back in `ScanState::Text` because it could be the start of a
    /// data URL prefix (e.g. trailing `"data:im"` awaiting the next delta to
    /// complete `"data:image/..."`). Emitted as Delta once disproven.
    pending_text: String,
}

#[derive(Default)]
enum ScanState {
    #[default]
    Text,
    /// Inside a data URL, accumulating base64 chars until a non-base64 char
    /// terminates the run. `buf` holds the full `data:image/<mt>;base64,<...>`
    /// string so far; `media_type` is the parsed MIME.
    Image { buf: String, media_type: String },
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum ScanEvent {
    Delta(String),
    Image { data: String, media_type: String },
}

/// Base64 alphabet (RFC 4648): `A-Z`, `a-z`, `0-9`, `+`, `/`, and `=` padding.
/// Anything else terminates a data URL run.
fn is_base64_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '+' || c == '/' || c == '='
}

struct DataUrlPrefixMatch {
    prefix_start: usize,
    prefix_end: usize,
    media_type: String,
}

/// Find the first `data:image/<mt>;base64,` prefix in `s`. Returns its
/// byte range and the parsed media type (e.g. `"image/png"`). The media type
/// must be at least one char; `+`/`-`/`.`/alnum are accepted (covers png,
/// jpeg, webp, svg+xml, etc.). Returns `None` on no match.
fn find_data_url_prefix(s: &str) -> Option<DataUrlPrefixMatch> {
    let mut cursor = 0;
    loop {
        let start = match s[cursor..].find("data:image/") {
            Some(i) => cursor + i,
            None => return None,
        };
        let after = &s[start + "data:image/".len()..];
        let mt_end = after
            .find(|c: char| !c.is_ascii_alphanumeric() && c != '.' && c != '+' && c != '-')?;
        let mt = &after[..mt_end];
        if mt.is_empty() {
            // `data:image/;base64,` — not a valid data URL. Advance past this
            // false positive and keep scanning.
            cursor = start + "data:image/".len();
            continue;
        }
        let after_mt = &after[mt_end..];
        if !after_mt.starts_with(";base64,") {
            // `data:image/<mt>` not followed by `;base64,` — false positive.
            cursor = start + "data:image/".len();
            continue;
        }
        let prefix_end = start + "data:image/".len() + mt_end + ";base64,".len();
        return Some(DataUrlPrefixMatch {
            prefix_start: start,
            prefix_end,
            media_type: format!("image/{}", mt),
        });
    }
}

/// Length of the longest suffix of `s` that could be the start of a
/// `data:image/<mt>;base64,` data URL prefix (strict prefix — `s` ends mid-
/// prefix). Used to hold back trailing text that might complete into a full
/// prefix on the next delta. Returns 0 when the suffix can't be a prefix
/// start.
///
/// ponytail: iterate char boundary positions so suffix slices stay on UTF-8
/// boundaries — byte-indexed `&s[s.len()-n..]` panics on CJK chars (3 bytes
/// each). Capped at 30 bytes; 4-byte floor still skips spurious single letters.
fn partial_data_url_prefix_len(s: &str) -> usize {
    let mut best = 0;
    for (i, _) in s.char_indices() {
        let suffix_len = s.len() - i;
        if suffix_len < 4 || suffix_len > 30 {
            continue;
        }
        if could_start_data_url(&s[i..]) {
            best = best.max(suffix_len);
        }
    }
    best
}

/// True if `s` could be the start of a `data:image/<mt>;base64,<base64>` URL.
/// `s` is a strict prefix of `"data:image/"`, OR matches the partial pattern
/// `data:image/<mt>[;base64[,]]` shape. The empty string returns false —
/// holding back zero-length "prefixes" serves no purpose.
fn could_start_data_url(s: &str) -> bool {
    if s.is_empty() {
        return false;
    }
    // Strict prefix of the literal "data:image/" (e.g. "data", "data:", "data:im").
    if s.len() < "data:image/".len() && "data:image/".starts_with(s) {
        return true;
    }
    if !s.starts_with("data:image/") {
        return false;
    }
    let after = &s["data:image/".len()..];
    let mt_end = after
        .find(|c: char| !c.is_ascii_alphanumeric() && c != '.' && c != '+' && c != '-')
        .unwrap_or(after.len());
    let after_mt = &after[mt_end..];
    if after_mt.is_empty() {
        return true; // just "data:image/" + media-type chars so far
    }
    if !after_mt.starts_with(';') {
        return false;
    }
    let after_semi = &after_mt[1..];
    if after_semi.is_empty() {
        return true; // "data:image/<mt>;"
    }
    // Should be a strict prefix of "base64,".
    if after_semi.len() < "base64,".len() && "base64,".starts_with(after_semi) {
        return true;
    }
    false
}

impl ImageScanner {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    /// Process one Text delta. Returns the events to emit: zero or more
    /// `Delta` (text outside a data URL) and zero or more `Image` (complete
    /// data URLs). The scanner may hold back text as `pending_text` if it
    /// could be a partial data URL prefix; call `flush` at stream end.
    pub(crate) fn process_chunk(&mut self, chunk: &str) -> Vec<ScanEvent> {
        let mut events = Vec::new();
        let mut input: String = chunk.to_string();
        loop {
            // Take ownership of state to avoid borrow conflicts when reassigning.
            let state = std::mem::replace(&mut self.state, ScanState::Text);
            match state {
                ScanState::Text => {
                    self.pending_text.push_str(&input);
                    input.clear();
                    if let Some(p) = find_data_url_prefix(&self.pending_text) {
                        if p.prefix_start > 0 {
                            events.push(ScanEvent::Delta(
                                self.pending_text[..p.prefix_start].to_string(),
                            ));
                        }
                        // Split: prefix goes into the Image buf; post-prefix
                        // remainder stays in `input` for the Image state to
                        // consume on the next iteration.
                        let prefix = self.pending_text[p.prefix_start..p.prefix_end].to_string();
                        let post_prefix = self.pending_text[p.prefix_end..].to_string();
                        self.pending_text.clear();
                        self.state = ScanState::Image { buf: prefix, media_type: p.media_type };
                        input = post_prefix;
                        // Continue loop: Image state consumes `input` next.
                    } else {
                        // Hold back the longest partial-prefix suffix; emit
                        // the rest as Delta.
                        let hold = partial_data_url_prefix_len(&self.pending_text);
                        let emit_len = self.pending_text.len() - hold;
                        if emit_len > 0 {
                            events.push(ScanEvent::Delta(
                                self.pending_text[..emit_len].to_string(),
                            ));
                            self.pending_text = self.pending_text[emit_len..].to_string();
                        }
                        self.state = ScanState::Text;
                        break;
                    }
                }
                ScanState::Image { mut buf, media_type } => {
                    let end = input
                        .find(|c: char| !is_base64_char(c))
                        .unwrap_or(input.len());
                    if end > 0 {
                        buf.push_str(&input[..end]);
                    }
                    let prefix_len = format!("data:{};base64,", media_type).len();
                    let has_data = buf.len() > prefix_len;
                    if end < input.len() {
                        // Non-base64 char terminates the data URL run.
                        if has_data {
                            events.push(ScanEvent::Image { data: buf, media_type });
                        } else {
                            // ponytail: malformed data URL (no base64 data
                            // after prefix). Emit the prefix as plain text
                            // so the user sees something — better than a
                            // silent drop.
                            events.push(ScanEvent::Delta(buf));
                        }
                        self.state = ScanState::Text;
                        input = input[end..].to_string();
                        // Continue loop: Text state consumes `input` next.
                    } else {
                        // All of `input` was base64 (or input was empty);
                        // stay in Image state, wait for more deltas.
                        self.state = ScanState::Image { buf, media_type };
                        break;
                    }
                }
            }
        }
        events
    }

    /// Flush at stream end. Emits any buffered text as Delta and any buffered
    /// image data as Image (best-effort — partial base64 at end of stream is
    /// emitted as if complete).
    pub(crate) fn flush(&mut self) -> Vec<ScanEvent> {
        let mut events = Vec::new();
        let state = std::mem::replace(&mut self.state, ScanState::Text);
        match state {
            ScanState::Text => {
                if !self.pending_text.is_empty() {
                    events.push(ScanEvent::Delta(std::mem::take(&mut self.pending_text)));
                }
            }
            ScanState::Image { buf, media_type } => {
                let prefix_len = format!("data:{};base64,", media_type).len();
                if buf.len() > prefix_len {
                    events.push(ScanEvent::Image { data: buf, media_type });
                } else if !buf.is_empty() {
                    // ponytail: malformed at stream end — emit as text.
                    events.push(ScanEvent::Delta(buf));
                }
            }
        }
        events
    }
}
