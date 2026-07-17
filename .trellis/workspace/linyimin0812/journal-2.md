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


## Session 60: extract pet host bridge from App.tsx

**Date**: 2026-07-16
**Task**: extract pet host bridge from App.tsx
**Package**: api
**Branch**: `master`

### Summary

Final center-rot cleanup from the architecture audit: extracted App.tsx's inline pet event-bus plumbing (pet://menu-action switch, pet://bubble-action jump router, pet://visibility-changed sync, pet-mode launch restore, pet-icon orphan sweep) into a usePetHostBridge() hook, with the routing logic split into pure routePetMenuAction/routePetBubbleAction helpers (testable, no React). App.tsx 664->391 lines (-273); root component no longer welds an optional feature's plumbing. petNotifyDispatcher (pet://notify) left as-is — already cohesive. hide_all_webviews page-change effect and the useDisableAutoCapitalize MutationObserver preserved (out of scope, not pet:// event-bus). 2 PRs: PR1 built the hook + router + 22 sibling tests dormant; PR2 flipped App to the one-line call + deleted the 4 inline blocks. Behavior zero-regression (PR1 verbatim lift, PR2 call-site swap); check zero issues; tsc/build/tests green (4 pre-existing master failures unchanged). This completes the audit's named center-rot list: settingsStore split, editorStore split + aiStore dependency inversion, HtmlPreview sandbox, App pet bridge.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `b6c0d84` | (see git log) |
| `4c18409` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 61: centralize editor tabId into FileChangeApplier

**Date**: 2026-07-16
**Task**: centralize editor tabId into FileChangeApplier
**Package**: api
**Branch**: `master`

### Summary

Closed the editorStore PR3 deferred tail: the accept/reject editor slice (tabId format ${vaultId}:${path} + tab lookup + which editorStore/diffReviewStore method to call) was still inlined in aiFileChangeActions, leaking editor-domain knowledge into the AI layer. Extended FileChangeApplier with acceptEditorChange(path, newContent) + revertEditorTab(path, oldContent); extracted a private resolveTab(path) helper that apply/accept/revert all reuse, so the tabId format + tab lookup live in one editor-owned place. aiFileChangeActions now delegates the editor slice through the applier interface (getFileChangeApplier()?.acceptEditorChange/revertEditorTab) and no longer imports editorStore/diffReviewStore; disk IO (writeTextFile) + session status mutation stay in aiFileChangeActions as the orchestrator so reject's interwoven operation is not split. FileChangeApplier is now the complete editor-side file-change abstraction (apply/accept/revert three states). The new aiStore<->aiFileChangeActions ESM cycle is TDZ-safe (hoisted function declarations, no module-eval cross calls) — same shape as the editorStore<->editorIoService cycle, documented with a comment per the spec's ESM-cycle gotcha. Single PR; check zero issues; behavior zero-regression; tsc/build green, 23 targeted tests pass. This fully closes the audit's center-rot list + the editorStore PR3 tail.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `d782b0e` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 62: Voice input: toggle hotkey + floating SiriGL orb + cross-app paste

**Date**: 2026-07-17
**Task**: Voice input: toggle hotkey + floating SiriGL orb + cross-app paste
**Package**: api
**Branch**: `master`

### Summary

Ported openless toggle-mode voice hotkey + verbatim SiriGL WebGL orb in a floating always-on-top NSPanel visible across all apps. Fixed cross-app Cmd+V paste: (1) dev-voice.mjs bundle codesign with --deep + entitlements (Info.plist sealed so TCC grants stick); (2) release build via tauri.conf.json signingIdentity='-' + new build-mac.sh mirroring openless (xattr -cr quarantine + tccutil reset per rebuild); (3) StrictMode-racing hydration in App.tsx via useVoiceStore.subscribe; (4) voice-orb can_become_key_window=false + hide-before-paste so the orb NSPanel never swallows the Cmd+V event. Dropped Linux from release.yml matrix; voice is macOS-only via cfg gate. File-based paste diagnostic logs at ~/Library/Logs/quill-voice-debug.log for release-build debugging (log::info! is no-op without tauri-plugin-log).

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `ca07ab1` | (see git log) |
| `9ac4c42` | (see git log) |
| `3b05d61` | (see git log) |
| `73b0983` | (see git log) |
| `76e8231` | (see git log) |
| `dc81f1a` | (see git log) |
| `ef5c3f2` | (see git log) |
| `d3e6f6d` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete
