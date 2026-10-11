# Research: Double-click over-selection in markdown preview — CSS bisect

- **Query**: Double-clicking a word in the macOS WKWebView markdown preview selects far too much ("extends from the word to a distant point"), English and Chinese. Bisect the CSS in real Safari.
- **Scope**: mixed (repro harness + WebKit/Chromium automation + internal CSS/JS audit + web search)
- **Date**: 2026-10-11

## Verdict (read this first)

**No repro. The preview CSS is innocent.** In WebKit (real WebKit engine, Playwright build 27.2) and Chromium, every variant V1–V4, every property toggle, scrolled/unscrolled, retina DPR 2, and `zoom: 1.25` all select **exactly the target word** (`quick` / `riverbank` / `公园` / `风景`) for both English and Chinese. No minimal CSS trigger exists. **The cause is elsewhere** — see "Where the cause actually is" below.

**Caveat — real Safari could not be driven.** `safaridriver` requires Safari's "Allow Remote Automation", which is off on this machine. Enabling needs `sudo safaridriver --enable` (no sudo password available in this session), and the preference can't be written directly: `~/Library/Containers/com.apple.Safari/.../com.apple.Safari.plist` returns "Operation not permitted" (SIP-protected container). Apple Events to System Events are also unauthorized (-1743). Substitute used: **Playwright WebKit 27.2** — the same engine Safari 26.x ships, driven through real hit-testing and input synthesis. To rerun in real Safari: enable the checkbox in Safari's Develop menu (or `sudo safaridriver --enable`), then re-run `bisect-driver.mjs` with a WebDriver client.

## Repro artifacts

| File | Description |
|---|---|
| `research/dblclick-bisect.html` | V1–V4 variant page (English + Chinese long paragraphs, marker words) |
| `research/bisect-driver.mjs` | Playwright driver: per-variant marked + mid-paragraph word dblclick, records selection text/length/offsets (needs playwright + webkit/chromium, run from any dir) |
| `research/bisect-drill.mjs` | Drill-down: property toggles, zoom 1.25, scroll states, DPR 2, mouse-jitter + layout-shift mechanism probes |
| `research/results-webkit.json`, `results-chromium.json`, `drill-webkit.json`, `drill-chromium.json` | Raw machine results |

## Variant results table

Double-click via real input pipeline (`mouse.dblclick`, clickCount=2) at the geometric center of the target word; selection read from `getSelection()`.

| Variant | What Safari/WebKit selected (en / zh, marked) | What WebKit selected (mid-paragraph word) | What Chrome selected |
|---|---|---|---|
| V1 control, no styles | `quick` (5 chars) / `公园` (2 chars) | `riverbank` (9) / `风景` (2) | identical to WebKit |
| V2 Sora 14px, line-height 1.6 | `quick` / `公园` | `riverbank` / `风景` | identical |
| V3 V2 + overflow-wrap:break-word, max-width 800, margin auto, text-align left | `quick` / `公园` | `riverbank` / `风景` | identical |
| V4 V3 inside scroll container (overflow auto, scrollbar-gutter stable, padding 8px 32px, pb 100vh) | `quick` / `公园` | `riverbank` / `风景` | identical |

Engine versions: Playwright WebKit **27.2** (Safari-family engine), Chromium headless-shell **156.0.8078.4**.

### Drill-down (all on V4, all clean — selection length 5 for `quick`, 2 for `公园`)

| Toggle / state | Result |
|---|---|
| `line-height: normal` | exact word |
| `font-family: system-ui` | exact word |
| `overflow-wrap: normal` | exact word |
| `scrollbar-gutter: auto` | exact word |
| `body { -webkit-font-smoothing: antialiased }` | exact word |
| `.v3 { zoom: 1.25 }` (CSS zoom on the preview, like `--md-zoom`) | exact word |
| inner container `scrollTop` 0 / 200 / 600 before dblclick | exact word |
| page `scrollY` 0 / 800 before dblclick (V3) | exact word |
| `deviceScaleFactor: 2` (retina) | exact word |
| jitter / layout-shift-between-clicks probes | **inconclusive** — synthetic `down/up/down/up` sequences do not carry the OS double-click flag (clickCount=2), so they collapse the selection instead of triggering double-click-drag granularity. These mechanisms can only be exercised with a real mouse. |

## Sora font resolution (asked explicitly)

- `apps/desktop/src/index.css` **line 1**: `@import url('https://fonts.googleapis.com/css2?family=...Sora:wght@300;400;500;600;700...&display=swap');` — **Sora IS loaded as a Google webfont**, not a system font.
- `--font-ui: 'Sora', sans-serif` (line 45); `.md-preview` uses it via `font-family: var(--font-ui)` (line 446).
- Verified in the repro harness: `document.fonts.check('14px Sora')` → true; computed style `Sora, sans-serif`.
- If the webview has no network access to fonts.googleapis.com, it silently falls back to `sans-serif` (Helvetica Neue). Either way: **innocent in the bisect** — V2 with real Sora loaded still selects exactly one word.
- Note: Sora has **no CJK glyphs**, so Chinese text in `.md-preview` never renders in Sora — it falls through to the system font (PingFang SC), regardless of the `Noto Sans SC` also present in the same @import (it's not in the `--font-ui` stack). English and Chinese therefore run through *different* fonts in the preview — and both misbehave in the app, which further points away from font-specific text shaping.

## Web findings

Search engines (DDG html/lite, Mojeek, Bing) were mostly bot-blocked this session; WebKit Bugzilla quicksearch and the StackExchange API worked. Nothing matches "CSS makes dblclick select too much":

- [WebKit Bug 35141 — Double-click selects the whole "aaa.bbb.ccc" string instead of a sub-string](https://bugs.webkit.org/show_bug.cgi?id=35141) — word-granularity treats punctuation-joined tokens as ONE word. Closest known behavior class: if the app's text contains long punctuation/underscore-joined runs, dblclick legitimately selects the whole run.
- [WebKit Bug 12446 — Double-clicking near the trailing edge of a word selects the space following it](https://bugs.webkit.org/show_bug.cgi?id=12446) — adjacent-space only, not "distant point".
- [WebKit Bug 62606 — include ending newline in selection](https://bugs.webkit.org/show_bug.cgi?id=62606), [Bug 36256 — shift+click extends by space](https://bugs.webkit.org/show_bug.cgi?id=36256) — minor granularity quirks, not our symptom.
- [SO: Text selection on double click in HTML with a float](https://stackoverflow.com/questions/25198831/) — floats + dblclick select odd ranges; not applicable (no floats in `.md-preview`).
- Tauri GitHub issue search (`WKWebView double click selection`): no user reports.
- No known WebKit bug tying `overflow-wrap`, `line-height`, `scrollbar-gutter`, or `zoom` to over-long double-click selections.

## Where the cause actually is (given CSS is exonerated)

Ranked hypotheses for the in-app symptom, each with a cheap next test:

1. **The actual text content** — WebKit's word granularity (Bug 35141 class). The rendered DOM is "a plain `<p>` with a single text node", but the *codepoints* matter: zero-width spaces (U+200B), NBSPs (U+00A0), variation selectors, or long punctuation-joined runs all change what ICU considers "one word", for English and Chinese alike. Test: in the app, run on the misbehaving paragraph `[...p.textContent].map(c => c.codePointAt(0)).filter(c => c < 0x20 || (c >= 0x2000 && c <= 0x200f) || c === 0xfeff || c === 0x00a0)` and check the selection's `anchorOffset/focusOffset` — if the whole span between word and "distant point" is punctuation-free normal text, this is not it.
2. **Layout shift between the two physical clicks** (double-click-drag semantics). If anything moves content between click 1 and click 2 (React re-render, `rehypeBlankGap` inline-height writes — `MarkdownPreview.tsx` line 279 writes `style.height` on elements, `usePreviewCursorSync` reacting to selection/editor state), the second click lands far away and WebKit selects word-to-word: *exactly* "from the word to a distant point". Not reproducible synthetically (see table note). Test in-app: on `dblclick`, log `getSelection().anchorOffset/focusOffset` and whether a React commit happened between the two clicks (React DevTools highlight-commits, or a MutationObserver on `.prev-body` that logs timestamped attribute changes around the dblclick).
3. **Tauri/WKWebView input or zoom level** — the app's webview (Tauri `setZoom`/window scale, retina backing) can offset synthesized coordinates; the plain WebKit page at DPR 2 is clean, but the native webview configuration is the remaining untested environment. Test: reproduce inside a minimal Tauri window, or in the app with the devtools open checking where `caretRangeFromPoint` at the dblclick point actually lands.

JS selection-manipulation was ruled out by grep: the only selection access in the preview path is `PreviewPane.tsx:75` (`handlePreviewClick` *reads* `isCollapsed` and returns early — no mutation).

## Recommended fix (workaround if the real cause can't be eliminated)

A `dblclick` handler on `.prev-body` that normalizes the selection to the word under the caret:

```ts
prevBody.addEventListener('dblclick', (e) => {
  const range = document.caretRangeFromPoint(e.clientX, e.clientY);
  if (!range || !range.startContainer.textContent) return;
  const text = range.startContainer.textContent;
  let start = range.startOffset, end = start;
  const isWord = (c: string) => /[\p{L}\p{N}_]/u.test(c);
  while (start > 0 && isWord(text[start - 1])) start--;
  while (end < text.length && isWord(text[end])) end++;
  if (end > start) {
    const sel = getSelection();
    sel.setBaseAndExtent(range.startContainer, start, range.startContainer, end);
  }
});
```

For CJK this selects a single character at minimum; `Intl.Segmenter('zh', { granularity: 'word' })` over the text node can be used if whole Chinese words are wanted. `caretRangeFromPoint` is non-standard-but-permanent in WebKit (the app is WKWebView-only), so no cross-browser concern.

## Caveats / Not Found

- Real Safari (safaridriver) not driven — permission-gated as described above; Playwright WebKit 27.2 is the closest available engine.
- Playwright WebKit is the upstream engine build, not the exact Safari 26.5.2 system build; a Safari-only regression introduced after that branch is (low-probability) possible.
- Synthetic input cannot emulate double-click-drag (mouse moving a few px between the two clicks) — mechanism 2 above remains unverified.
- Raw JSON results in `results-*.json` / `drill-*.json` (same directory).
