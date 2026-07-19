# String Unescaper Plugin

## Goal
A sandbox-tier tool plugin: paste a string literal (optionally quoted), unescape
`\n` / `\t` / `\"` / `\\` / `\uXXXX` etc., and render the result as Markdown when
it parses as such.

## Scope (MVP)
- One tool window (`window: true`), opened via ⌘P → "Open: String Unescaper".
- Single textarea input (live, no button needed).
- Strip one surrounding pair of `"..."` or `'...'` if both present at ends.
- Unescape standard JS/JSON escapes: `\b \t \n \f \r \" \' \\ \/ \uXXXX \xXX \0 \v`.
- Two-pane preview:
  - Top: unescaped raw text (read-only `<pre>`).
  - Bottom: rendered Markdown (subset), HTML-sanitized.
- Minimal inline Markdown renderer (no external deps — CSP forbids remote and
  the lazy path is a ~80-line subset, not vendoring a lib).

## Out of scope
- Clipboard read / insert-into-doc buttons (user did not request).
- Full GFM / CommonMark (tables, footnotes, raw HTML). ponytail: subset; upgrade
  by swapping in `marked.js` co-located in the plugin folder when needed.
- Trusted-tier panel/container contributions.

## Files
- `examples/plugins/string-unescaper/manifest.json`
- `examples/plugins/string-unescaper/index.html`
- `examples/plugins/string-unescaper/index.js`

## Verification
- Install via Settings → Plugins → 从文件夹安装….
- ⌘P → "Open: String Unescaper".
- Paste `"# Hi\\n\\nThis is **bold** and \`code\\``"` → top shows the unescaped
  text, bottom shows rendered H1 + bold + inline code.
