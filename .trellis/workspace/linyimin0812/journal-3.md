# Journal - linyimin0812 (Part 3)

> Continuation from `journal-2.md` (archived at ~2000 lines)
> Started: 2026-08-03

---



## Session 115: Fix markdown file-preview rerender on every keystroke

**Date**: 2026-08-03
**Task**: Fix markdown file-preview rerender on every keystroke
**Package**: api
**Branch**: `master`

### Summary

Markdown preview rebuilt componentMap and VaultContext value on every keystroke, causing every :::file-preview block to re-fetch and re-mount. Moved content/onChange into refs read by the pre wrapper, dropped them from componentMap deps, and memoized VaultContext value. Root-cause fix, 27-line diff, no new deps.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `9795ff2` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 116: file-preview html 支持导出

**Date**: 2026-08-03
**Task**: file-preview html 支持导出
**Package**: api
**Branch**: `master`

### Summary

processFilePreviews 兜底分支前加 if (body.querySelector('iframe')) return; html file-preview 的 iframe (srcDoc+sandbox 自包含) 原样保留,不再落到'此文件类型内容不支持导出'卡片。一行修复。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `9735f1f` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 117: Desktop pet icon: GIF support

**Date**: 2026-08-03
**Task**: Desktop pet icon: GIF support
**Package**: api
**Branch**: `master`

### Summary

Extended VALID_EXTS in PetSettings.tsx to include 'gif' so users can upload animated GIFs as the desktop pet mascot. Render path (PetMascot <img>) already animates GIFs natively in the Tauri webview — no renderer change needed. 10MB cap and existing fallback logic reused.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `811f946` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 118: Fix file-preview locking preview scroll

**Date**: 2026-08-03
**Task**: Fix file-preview locking preview scroll
**Package**: api
**Branch**: `master`

### Summary

Tightened .prev-body:has(.image-viewer/.html-preview-frame/.pdf-viewer) to direct-child :has(> ...) so embedding image/html/pdf via :::file-preview in markdown no longer applies overflow:hidden to the whole preview pane. Standalone .png/.svg/.html/.pdf full-bleed behavior preserved.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `66f6759` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 119: Dark-mode markdown editor indent markers

**Date**: 2026-08-04
**Task**: Dark-mode markdown editor indent markers
**Package**: api
**Branch**: `master`

### Summary

Fixed jarring vertical indent-guide lines in the markdown editor under dark mode. Root cause: @replit/codemirror-indentation-markers sets --indent-marker-bg-color via its &dark selector, which only activates when the editor has the cm-dark class — this project never adds it, so dark mode fell back to the light default (#F0F1F2, near-white) on a #0b0d14 background. Overrode the var on [data-theme=dark] .cm-indent-markers to match the existing dark border palette (#1c2136 / #252d4a). Inline change per user; no task created.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `103db28` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 120: Fix AI Panel Chat table overflow

**Date**: 2026-08-04
**Task**: Fix AI Panel Chat table overflow
**Package**: api
**Branch**: `master`

### Summary

AI Panel Chat 中 AI 返回含宽表格的消息时会撑破 380px 面板布局。根因：apps/desktop/src/index.css 的 .msg-md table 无宽度约束（对比 .md-preview table 已有 width:100%）。最小 CSS 修复：将 .msg-md table 改为 display:block; width:max-content; max-width:100%; overflow-x:auto，宽表在气泡内横向滚动，窄表保持自然宽度。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `c29d591` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete
