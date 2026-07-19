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


## Session 63: 麦克风/语音识别权限接入设置页

**Date**: 2026-07-18
**Task**: 麦克风/语音识别权限接入设置页
**Package**: api
**Branch**: `master`

### Summary

镜像辅助功能权限行,把麦克风与语音识别也做成设置页里可显式触发系统授权框的入口。后端新增 voice_request_microphone / voice_request_speech 两个 IPC(spawn_blocking 复用现有 permissions::request_microphone 与 apple_speech::ensure_authorized),非 macOS 桩返回 false;前端抽 PermissionRow 组件三处复用,新增麦克风/语音识别两行,文案点明拒绝后需去系统设置开启。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `50976cd` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 64: Voice flow phases + API key prompt + orb UX polish

**Date**: 2026-07-18
**Task**: Voice flow phases + API key prompt + orb UX polish
**Package**: api
**Branch**: `master`

### Summary

Surfaced recording → transcribing → polishing → inserting phases on the voice-orb (hotkey + button paths) + mic button title/color, with an inline 「未配置 API Key · 打开设置」 prompt when polish is skipped due to missing chatApiKey. Added a new 'open-ai-settings' PetMenuAction to fix a latent cross-realm navStore bug (secondary windows can't mutate main window's store) that affected VoiceOrbApp + PetChat + PetChatSessionHeader. Linger 5s on inserting phase so the prompt is clickable, with re-show of the orb window after Rust's hide-before-paste. Mic button no longer steals key focus (Cmd+V paste was landing in void). Swapped AI panel mic icon to theme-aware cwmMicOn svg pair. Orb caption adapts to OS prefers-color-scheme + has a semi-transparent pill background for any backdrop. Spec captured the cross-realm navStore pitfall in tauri-window-patterns.md.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `746586f` | (see git log) |
| `f2622e6` | (see git log) |
| `09c1bd4` | (see git log) |
| `5e20e25` | (see git log) |
| `e7474cd` | (see git log) |
| `f4e4f88` | (see git log) |
| `814ff67` | (see git log) |
| `76feb1b` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 65: Remove Chat/Wiki/Clip tabs from AI Panel

**Date**: 2026-07-18
**Task**: Remove Chat/Wiki/Clip tabs from AI Panel
**Package**: api
**Branch**: `master`

### Summary

Stripped AiPanel tab bar + chatMode state machine + /clip slash branch + wiki/clip render branches; deleted 6 sub-components (WikiToolbar/ClipToolbar/WikiActivityLog/ReviewItemList/IngestDialog/DeepResearchDialog); dropped 3 mode.ai-* commands from commandRegistry; updated aiStore/featureAgentService tests. Sidebar wiki/clip entries untouched. tsc -b clean, 76 tests pass.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `1431983` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 66: Settings page polish: icons + fonts

**Date**: 2026-07-19
**Task**: Settings page polish: icons + fonts
**Package**: api
**Branch**: `master`

### Summary

Replaced emoji icons on settings page with lucide-react stroke icons (18 emoji -> 14px/17px currentColor line icons across NAV_GROUPS, SettingsPage about/notice cards, PluginsSettings warning). Unified editable control fonts: font-mono -> font-ui on inputs in Skills/FileTemplates, dropped inline fontFamily overrides. Unified font sizes: hardcoded text-xs -> var(--ui-font-size) formula on 9 editable controls so they scale with UI font-size setting. Also fixed earlier: drawio loading placeholder + markdown ordered list start=3 rendering (counter-reset: list-item CSS bug).

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `8af84ec` | (see git log) |
| `b5137a8` | (see git log) |
| `6414037` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 67: Plugin: string-unescaper sandbox tool

**Date**: 2026-07-19
**Task**: Plugin: string-unescaper sandbox tool
**Package**: api
**Branch**: `master`

### Summary

Sandbox-tier tool window plugin. Paste a string literal (with or without surrounding quotes), get live unescape (\n \t \uXXXX \xXX etc.) + Markdown-rendered preview. No permissions, no RPC. Theme follows OS via prefers-color-scheme (sandbox iframe can't read host [data-theme], same approach as VoiceOrbApp). Cmd/Ctrl+A explicit keydown handler so Tauri menu accelerators don't intercept select-all. Autocapitalize/spellcheck off on input.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `0c96f93` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 68: VS Code-style find/replace panel for CM editors

**Date**: 2026-07-19
**Task**: VS Code-style find/replace panel for CM editors
**Package**: api
**Branch**: `master`

### Summary

Built a custom React search/replace bar (EditorSearchBar) that replaces the default CodeMirror search panel across markdown / json / html-source editors. Reuses the CM search() extension for query state + highlights + find/replace commands; only the UI layer is replaced. VS Code styling: case/word/regexp toggles, x-of-y count, prev/next, replace-single + replace-all, Cmd+F toggle, Cmd+Alt+F toggle replace row. Fixed-width panel (380px), gray panel bg + white input bg per user request.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `da11729` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 69: Find-input inline toggles + thin-line selection

**Date**: 2026-07-19
**Task**: Find-input inline toggles + thin-line selection
**Package**: api
**Branch**: `master`

### Summary

Moved Aa/ab/.* toggles inside the find input (VS Code style, absolute-positioned with right padding on input). Find input selection styled as a thin accent-color underline (text-decoration in ::selection) instead of a solid background block. Native Cmd+A in find input selects only input text — CM's Mod-a keymap is bound to .cm-editor, a sibling of the SearchBar, so it doesn't intercept.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `056d6b1` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 70: Plugin AI capability: expose chat/agent to plugins via permissions.ai

**Date**: 2026-07-19
**Task**: Plugin AI capability: expose chat/agent to plugins via permissions.ai
**Package**: api
**Branch**: `master`

### Summary

Added permissions.ai = {chat?, agents?[]} manifest field; trusted PluginContext.ai.chat wraps runRigChat, ctx.ai.agent wraps runFeatureAgent; sandbox ai:chat RPC streams via ai-stream postMessage. Provider/model/apiKey never leave host. 23 new tests green; examples for both tiers + docs.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `548e61f` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete
