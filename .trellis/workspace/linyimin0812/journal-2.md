# Journal - linyimin0812 (Part 2)

> Continuation from `journal-1.md` (archived at ~2000 lines)
> Started: 2026-07-16

---



## Session 59: harden HtmlPreview sandbox + split editorStore god-store

**Date**: 2026-07-16
**Task**: harden HtmlPreview sandbox + split editorStore god-store
**Package**: api
**Branch**: `master`

### Summary

Two architecture-hardening tasks from the audit. (1) Fixed the HtmlPreview sandbox privilege-escalation hole: allow-scripts allow-same-origin -> allow-scripts only; the two legit onLoad parent-DOM ops (light-theme style, #hash anchor nav) moved into srcDoc content injection via injectPreviewBootstrap (DOMParser), no postMessage bridge, zero behavior change; spec gained a sandboxed-iframe convention. (2) Split the 665-line editorStore god-store across 3 PRs: editorViewState (cursor/wordCount/panels) + diffReviewStore (diff mode + externalContentVersion) + editorIoService (file IO lifted from store actions), core tab lifecycle + web-tab ops stayed in editorStore (665->277). Inverted the aiStore->editorStore reverse dependency via a FileChangeApplier interface owned by the editor layer, type-only-imported + module-level injected into aiStore (no runtime cycle), unregistered=no-op for init safety; the useCodeMirror mounting policy that lived in aiStore moved into the editor-owned applier. End-to-end test covers all three apply branches. Spec gained a cross-store dependency-inversion convention + ESM-cycle gotcha. Both check passes zero issues; tsc/build/tests green (5 failures pre-existing on master).

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `c12b002` | (see git log) |
| `0dce06c` | (see git log) |
| `52ef395` | (see git log) |
| `a431f4e` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete
