# Journal - linyimin (Part 1)

> AI development session journal
> Started: 2026-06-29

---



## Session 1: 学习功能 workbench：资料/计划/复习/知识库 + SM-2 + AI agent

**Date**: 2026-07-01
**Task**: 学习功能 workbench：资料/计划/复习/知识库 + SM-2 + AI agent
**Package**: api
**Branch**: `bold-beacon`

### Summary

新增'学习'工作台：主题= vault markdown(## 资料/计划/笔记/复习 段托管写回)；多主题管理；SM-2 间隔复习+跨主题今日复习队列；与 schedule 单向关联(cat:learn+回链)；5 个 AI 动作(研究/计划/费曼/自测/SQ3R)；资料建议卡片+手动CRUD+选中资料生成计划；专用 study agent(.claude/agents 风格文件+内联 --agents 交付)+自主 study 会话(不预填聊天框)。10 PR，688 测试。通用 agent 框架泛化留待新任务。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `6bb9e63` | (see git log) |
| `eddc15b` | (see git log) |
| `4e625b5` | (see git log) |
| `97d8fdf` | (see git log) |
| `79b56b7` | (see git log) |
| `ea9d7e5` | (see git log) |
| `1d1c9e0` | (see git log) |
| `0b593af` | (see git log) |
| `9dbad6a` | (see git log) |
| `b3f19bd` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 2: Desktop Pet Mode (macOS MVP)

**Date**: 2026-07-05
**Task**: Desktop Pet Mode (macOS MVP)
**Package**: api
**Branch**: `calm-meadow`

### Summary

Added a desktop pet mode to Folyn: a transparent always-on-top Tauri window with an ink-drop + folyn-tip SVG mascot (4 CSS/SVG states: idle/hover/drag/click). Single-click focuses the main window; right-click opens a native popup context menu (Show Main Window / New Note / Toggle AI Panel / Disable Pet Mode). Toggle via View-menu checkable item (Cmd+Shift+P) with bidirectional checkmark sync. Position persisted to settingsStore and restored on launch. Click-through on transparent regions via setIgnoreCursorEvents polling. Auto-hide when the main window is fullscreen. CloseRequested hides main instead of quitting while pet visible. Captured reusable patterns in a new spec (tauri-window-patterns.md: ACL permission contract, native popup menu, close-to-tray, click-through). Merged to master and pushed to origin.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `ab46e8c` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 3: Desktop Pet Visibility Fix

**Date**: 2026-07-05
**Task**: Desktop Pet Visibility Fix
**Package**: api
**Branch**: `calm-meadow`

### Summary

Fixed two bugs found when manually enabling desktop pet mode: (1) pet window was not transparent — index.html's hardcoded data-theme=light + index.css body background made the 120x120 window opaque; fixed by gating an is-pet-window class on the #/pet route and scoping background:transparent !important in pet.css. (2) default position unit mismatch — PetApp divided monitor.size by scaleFactor (logical px) but set_pet_position expects PhysicalPosition (physical px), so the pet landed mid-screen on retina displays; fixed by extracting computeDefaultPetPosition (physical in/out, clamped >=0). Added petPosition unit tests. Appended a 'Transparent Window Inherits Opaque Body Background' common-mistake section to tauri-window-patterns.md.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `943e6f2` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 4: Desktop Pet Position & Drag Fix

**Date**: 2026-07-05
**Task**: Desktop Pet Position & Drag Fix
**Package**: api
**Branch**: `calm-meadow`

### Summary

Fixed pet clipped behind the macOS Dock (computeDefaultPetPosition now uses separate per-axis margins: PET_BOTTOM_MARGIN=80 clears the Dock, PET_RIGHT_MARGIN=20, clamp y>=PET_MIN_TOP=40) and fixed drag not working (PROBE_INTERVAL_MS 250->60 so setIgnoreCursorEvents flips within one frame of cursor entry, plus proactive ignore=false at drag end for follow-up clicks). Updated tauri-window-patterns.md click-through latency note.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `8d94f03` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 5: Split SettingsPage god file + useHotkeyRecording extraction

**Date**: 2026-07-18
**Task**: Split SettingsPage god file + useHotkeyRecording extraction
**Package**: api
**Branch**: `calm-canyon`

### Summary

Architectural rot assessment identified SettingsPage.tsx (1468 lines) as the top-ROI refactor. Split into per-tab components under components/settings/ (FileTemplates, Skills, Pet, Notifications + primitives + ShortcutEditor), matching the existing PluginsSettings/VoiceSettings convention — pure mechanical move, SettingsPage drops to ~440 lines. Then extracted useHotkeyRecording hook (recording state + capture-phase keydown + click-outside + optional conflict-timeout), refactored ShortcutEditor + VoiceHotkeyRecorder onto it as thin shells (keyshape/persistence/OS re-register stay in callers), removing ~30 lines of voice recorder duplication and resolving the self-noted debt at VoiceSettings.tsx:63-68. Two concrete consumers justify the hook (not speculative). Verified: tsc clean for changed files, 6 hook self-tests, settings-domain store tests 72/72, zero regression (21 pre-existing failures proven unrelated via stash).

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `78207b4` | (see git log) |
| `655677f` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 6: Break ai↔chat cycle: move ToolCallBlock + FileImage into chat/

**Date**: 2026-07-18
**Task**: Break ai↔chat cycle: move ToolCallBlock + FileImage into chat/
**Package**: api
**Branch**: `calm-canyon`

### Summary

Architecture-rot assessment's 'three AI chat surfaces duplicate ToolCallBlock/FileImage/FileIcon' claim was STALE — verified ChatMessageList is already the shared render layer (consumed by AiPanel + PetChat). Real debt was the TODO(PR2) at ChatMessageList.tsx:5: chat imported ToolCallBlock + FileImage from ../ai/, and since ai/ already imports chat/ (AiPanel→ChatMessageList, ChatInput→ChatInputBox), this was a bidirectional ai↔chat cycle (the TODO's 'one-directional' note was wrong). Fixed by git mv'ing both files into components/chat/ (sole consumer; chat-internal, not promoted to index.ts), updating ChatMessageList imports to ./, dropping the resolved TODO. FileIcon untouched (already in icons/). After: chat depends only on neutral layers, ai→chat one-way. Verified tsc clean + chat tests 66/66; full suite identical to baseline (same 21 pre-existing failures, zero regression). Spec sync: directory-structure ai/ + chat/ entries.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `a032c0f` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 7: Split Rust commands.rs into per-domain submodules

**Date**: 2026-07-18
**Task**: Split Rust commands.rs into per-domain submodules
**Package**: api
**Branch**: `calm-canyon`

### Summary

commands.rs (1412 lines, 37 Tauri commands across file/webview/project/pet + managed-state structs + pet helpers + menu consts) was the Rust-side god file. Split into commands/ module dir: file_commands, webview_commands, project_commands (named project not git since remove_dir/get_project_overview aren't git), pet_commands (the ~980-line bulk). commands/mod.rs re-exports via glob. lib.rs UNCHANGED — mod commands resolves to commands/mod.rs and glob re-exports keep every commands:: symbol resolving, including Tauri's generate_handler! __cmd__ helpers (initially feared glob wouldn't carry macro-generated items, but verified it does). PetSizeState's shared-type constraint preserved via re-export. Hit one slicing bug (webview slice included git_clone's first doc line → orphan doc → 16 cascade __cmd__ errors), fixed by trimming the slice. Verified cargo check clean (0 errors/0 warnings) vs clean baseline; lib.rs diff empty. Spec sync: tauri-window-patterns.md.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `5ab8326` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 8: 桌宠外部通知 HTTP API

**Date**: 2026-07-22
**Task**: 桌宠外部通知 HTTP API
**Package**: api
**Branch**: `clever-desert`

### Summary

为桌宠新增本地 HTTP API(tiny_http,仅 127.0.0.1,无鉴权):POST /pet/action 触发 pet://notify 复用现有 dispatcher;GET /health 探活。默认端口 17382+重试,实际端口存内存并在桌宠设置页显示+curl 示例。Rust pet_api 模块(dispatch 纯函数 13 单测),前端 PetSettings 外部 API 区块,i18n zh/en,docs。trellis-check 自修了 React Hooks 顺序 bug。合并 master 时解决了 lib.rs(菜单重构)与 settings.json(pet.opacity/clickThrough 与 pet.api 同对象)冲突。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `32da186` | (see git log) |
| `2c21d73` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 9: Tiptap rich-text editor (.rt) as new file type

**Date**: 2026-07-29
**Task**: Tiptap rich-text editor (.rt) as new file type
**Package**: api
**Branch**: `bold-desert`

### Summary

Added a .rt rich-text file type backed by tiptap, distinct from the existing Markdown/CodeMirror editor. 3-PR MVP: PR1 scaffolded the file-type handler (auto-registry, .rt extension, sidebar quick button + other-type menu, view-mode auto-hide via allow-list); PR2 built the WYSIWYG editor (StarterKit + TaskList, self-drawn toolbar, JSON round-trip, drawio-style anti-write-back-loop guard with setContent({emitUpdate:false}) + race guard + stableStringify key-order normalization); PR3 added Image (vault assets via reused imageUploader/convertFileSrc, hash-named, vault-relative src persisted) + TableKit + a UrlModal replacing window.prompt, plus pure path-resolution helpers and a spec section in file-type-editors.md. 29 tests, tsc green.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `82173e4` | (see git log) |
| `eaec783` | (see git log) |
| `2f8fcd3` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 10: 富文本表格编辑优化：网格建表+悬浮加行列+合并拆分+对齐

**Date**: 2026-08-02
**Task**: 富文本表格编辑优化：网格建表+悬浮加行列+合并拆分+对齐
**Package**: api
**Branch**: `brave-bridge`

### Summary

Tiptap 富文本编辑器表格 UX 增强。新增 TableSizeGrid（8x8 悬停网格替换硬编码 2x2 插入）、TableControlsOverlay（光标进表时浮出 +行/+列 按钮，React overlay 不碰 TableKit TableView，追加到末尾语义用 setCellSelection+addRowAfter/addColumnAfter，位置取自 @tiptap/pm/tables TableMap.positionAt）；工具栏 tableButtons 扩展合并/拆分（can() 禁用态）、左中右对齐（cell align 属性→内联 text-align），图标改用 Columns3/Rows3/TableCellsMerge|Split/Align* 区分行列。round-trip 测试加 align 与 colspan/rowspan 用例。tsc 干净，rich-text 测试 18/18。已合并 master（rebase 后 push origin）。PRD Option A，零新依赖。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `f3944cb` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 11: Rich-text HTML export: extension-owned, popup local/remote, scoped vault styling

**Date**: 2026-09-14
**Task**: Rich-text HTML export: extension-owned, popup local/remote, scoped vault styling
**Package**: api
**Branch**: `master`

### Summary

Made the rich-text extension the single owner of HTML generation; deleted the host builtin. ExportMenu now routes extension exporters through FormatExportDialog so the local-vs-remote popup is shared. useExport and vaultExport discover exporters dynamically via findExporterByFormat / runExporterByFormat (no hardcoded extension IDs, graceful skip when the extension is unloaded). Fixed vault rich-text styling divergence by extracting the standalone <style> block and scoping it to .rt-doc via scopeCssSelectors — vault rich-text now matches standalone export without bleeding into sidebar or markdown docs.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `e89097a7` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 12: Vault 导出 unsupported 类型 + dbml SVG exporter + unsupported-text file type

**Date**: 2026-09-14
**Task**: Vault 导出 unsupported 类型 + dbml SVG exporter + unsupported-text file type
**Package**: api
**Branch**: `master`

### Summary

Vault 整库导出时仅排除图片类型;ft='unsupported' 或 handler.needsFileContent=false 的非图片文件渲染为 i18n 本地化的"不支持此文件类型"页(单文件 + folder standalone 两种模式)。dbml 从 CANVAS_EXPORT_TYPES 移除并照 rich-text 模式用 findExporterByFormat('dbml','svg',ctx) 动态发现扩展 manifest 声明的 SVG exporter(原来 renderFilePreviewToSvg 拿不到跨域 iframe 内容导致导出空)。拆分 'unsupported' 类型:binary 仍 preview-only,新增 'unsupported-text'(edit/split/preview,edit 标记 hidden 不出现在 switcher;defaultMode='preview')。SDK 的 PresentationModeRegistration 加 hidden 字段,getSupportedModes 过滤 hidden 模式,但 getMode 仍可解析供 split 使用。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `f30af5c6` | (see git log) |
| `6f797a98` | (see git log) |
| `0d03f56a` | (see git log) |
| `f9980a10` | (see git log) |
| `92ff86ae` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 13: Extension platform-service registration seams

**Date**: 2026-09-15
**Task**: Extension platform-service registration seams
**Package**: api
**Branch**: `master`

### Summary

Introduced two registration seams in @folyn/extension-host (CapabilityProvider + ContributionAdapter registries) mirroring registerLoader. buildExtensionApi folds providers into ExtensionApi; trustedLoader.activate folds adapters; normalizeModule is data-driven via moduleKey. createExtensionApi.ts self-registers 15 capability providers and delegates to buildExtensionApi. trustedContributions.ts is a single declarative manifest for all 12 trusted adapters. Zero behavior change; tsc clean; 53/53 extension-host tests green. trellis-check found and fixed a behavior-parity violation (highlightGrammars moduleKey) and adapter registration order.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `fdd2abda` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 14: Fix: pet-panel unpinned delete-session confirm dialog killed by blur auto-hide

**Date**: 2026-09-19
**Task**: Fix: pet-panel unpinned delete-session confirm dialog killed by blur auto-hide
**Package**: api
**Branch**: `master`

### Summary

Root cause: tauri-plugin-dialog parents native confirm() to the calling window; macOS presents it as a sheet on pet-panel. Sheet starting resigns key -> tauri://blur -> unpinned blur-auto-hide -> pet_panel_hide -> window hide tears the sheet down mid-question. Fix: window_has_modal_dialog guard (macOS attachedSheet, Windows IsWindowEnabled==0) in pet_panel_hide + hide_extension_tool_window; skip hide while a native modal dialog is attached. Spec updated: tauri-window-patterns.md Contracts.

### Main Changes

(Add details)

### Git Commits

(No commits - planning session)

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 15: Fix fullscreen webview shrink after screen lock

**Date**: 2026-09-22
**Task**: Fix fullscreen webview shrink after screen lock
**Package**: api
**Branch**: `master`

### Summary

修复 macOS 锁屏解锁后全屏窗口内容缩到左上角：visibilitychange/focus 触发 relayout_main_webview 命令，主线程 objc setFrame 把 WKWebView 重设为 contentView bounds（wry set_size 路径无效）。带 [relayout] 诊断日志。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `e1660132` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete
