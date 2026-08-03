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
