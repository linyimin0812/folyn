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


## Session 16: Translation popup input: Cmd+A select-all and left-align

**Date**: 2026-09-22
**Task**: Translation popup input: Cmd+A select-all and left-align
**Package**: api
**Branch**: `master`

### Summary

Fixed the extension-tool translation popup: added Cmd/Ctrl+A select-all for input/textarea in ExtensionToolApp's document keydown handler (the popup webview realm never sees the main window's App.tsx fallback, and Tauri's Edit menu has no Select All by design), and switched the shared TranslationPanel textarea from text-justify to text-left (covers both the popup and the main app's translation page).

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `738cd13c` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 17: Extension popup close focus restore

**Date**: 2026-09-22
**Task**: Extension popup close focus restore
**Package**: api
**Branch**: `master`

### Summary

Fix closing the extension-tool popup jumping back into the Folyn app: surface's activation made the panel Folyn's key window, so hide handed key to the main window. Reused the pet-panel frontmost-pid machinery — new extension_tool_adopt_frontmost command adopts pet_panel_show's pre-activation pid at the panel's tool-open sites; hide_extension_tool_window takes it and re-activates the user's app 150ms after hide when Folyn is still frontmost. Blur auto-hide skips restore; non-macOS untouched.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `948cb939` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 18: Markdown split mode: giant blank gap between list and code block

**Date**: 2026-09-22
**Task**: Markdown split mode: giant blank gap between list and code block
**Package**: api
**Branch**: `master`

### Summary

Fixed intermittent giant blank gap in markdown split preview. Root cause: CodeBlockWrapper root div lacked data-source-line, so capped (420px) code blocks were invisible to the blank-gap grid compensation — the next block's grid target counted the code block's full source-line span and dumped the shortfall into the preceding gap. Wrapper now carries data-source-line; gap compensation (extracted to gapCompensation.ts) exempts code-block shortfall from gap dumping and re-anchors the grid at the code block's rendered bottom. 86 tests pass, tsc clean.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `ef1b7d4e` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 19: Entity graph visual iteration, file-collector store publish, collector docs

**Date**: 2026-09-27
**Task**: Entity graph visual iteration, file-collector store publish, collector docs
**Package**: api
**Branch**: `master`

### Summary

Iterated the activity entity graph to a planned radial layout (per-direction slot radii for constant 110px visible edges, tangential-footprint-weighted angles, 1.5px theme-aware strokes, label pills) through several user-feedback rounds. Published folyn-file-collector 0.1.0 to the extension store (GitHub Release + catalog.json, rebase-merged alongside the github/window collectors). Removed the in-repo git-commit-collector (superseded by store entry). Committed + pushed the external-file-watch feature, trellis task dirs, and docs: first full documentation of the activity-collector contribution point across SDK docs (en+zh), extension-dev skill, publish checklist, and scaffold template. Smaller touches: file_deleted icon trash, rail font bump, collect-log page width 900px.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `d7c53f8f` | (see git log) |
| `4d164dbe` | (see git log) |
| `b3203237` | (see git log) |
| `2ab076fe` | (see git log) |
| `d378528e` | (see git log) |
| `ded04730` | (see git log) |
| `a096b393` | (see git log) |
| `70a673de` | (see git log) |
| `3cebbcc4` | (see git log) |
| `bcc95f91` | (see git log) |
| `87c27f56` | (see git log) |
| `c9d1ba04` | (see git log) |
| `a7237a73` | (see git log) |
| `03a54f6a` | (see git log) |
| `d912128c` | (see git log) |
| `a9185c63` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 20: P1 oversized-file refactor + extension popup focus fix + isTauri observation disposition

**Date**: 2026-09-27
**Task**: P1 oversized-file refactor + extension popup focus fix + isTauri observation disposition
**Package**: api
**Branch**: `master`

### Summary

架构评估(graphify)后落地: ①P1 拆分 6 个超大文件零行为变化(MarkdownPreview 1588→298+6模块, App.tsx 1247→430+9 hooks, PetApp 1073→289+4模块, apple_speech.rs 1431→5子模块, lib.rs 1359→991+2模块, chat.rs 1349→457+4子模块), tsc/cargo test 231/231/vitest 基线持平; ②扩展弹窗关闭抢焦点修复(搜索行路径补 adopt frontmost pid + 礼貌激活失败强激活兜底), chips 路径留 1-2 天观察期后摘诊断日志; ③isTauri 观察项勘察(硬编码 true, 160 死分支)用户拍板保留不动, 任务已归档。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `be7b7077` | (see git log) |
| `e52c0812` | (see git log) |
| `f96acd76` | (see git log) |
| `0f9a5231` | (see git log) |
| `2fcf2e6d` | (see git log) |
| `f4166654` | (see git log) |
| `c573629c` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 21: Report settings default-prompt button + report jump link & pet-notify toggle

**Date**: 2026-09-27
**Task**: Report settings default-prompt button + report jump link & pet-notify toggle
**Package**: api
**Branch**: `master`

### Summary

Added a 默认提示词 button to per-period prompt textareas in report settings (fills localized starter prompt, 6 locales; fixed key-casing interpolation bug). After report generation, the saved path in the banner is now a jump link opening the note in the editor; added a report-settings toggle for pet notification (default on, persisted); notification payload now carries a visible open-report action button (bubble/corner templates only render payload.actions). Also diagnosed transient macOS unclickable-app glitch (resolved by reboot) and confirmed activity SQLite data intact across vault switch.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `88ae0dac` | (see git log) |
| `43e60250` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 22: Windows front-window collector FFI fix

**Date**: 2026-09-27
**Task**: Windows front-window collector FFI fix
**Package**: api
**Branch**: `master`

### Summary

Diagnosed window-activity collector emitting zero events on Windows (github collector proved runtime/invoke/DB chain fine; only the powershell+Add-Type front_window probe failed silently). Replaced the Windows branch with direct windows-sys FFI (GetForegroundWindow/GetWindowTextW/GetWindowThreadProcessId/OpenProcess/QueryFullProcessImageNameW), app name from the owning process exe stem, log::warn on every failure path, exe_stem pure helper + tests, Win32_System_Threading feature added. User verified on Windows; macOS untouched.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `7f15254b` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 23: README: add activity collection section

**Date**: 2026-09-27
**Task**: README: add activity collection section
**Package**: api
**Branch**: `master`

### Summary

6 语言 README 新增活动采集章节（Why Folyn bullet + For Users 小节 + 时间线/关系图截图）；Extension system 更新：移除已删除的日程/Wiki，翻译标注内置，新增富文本/DBML/文件查看器与采集器条目，替换失效 extensions-1.png 为新 extension-system.png

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `ea45813a` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 24: Entity graph fan expansion + email collector multi-account

**Date**: 2026-09-29
**Task**: Entity graph fan expansion + email collector multi-account
**Package**: api
**Branch**: `master`

### Summary

实体图谱：≤5 成员聚合组点击后在图内以外向弧展开为同款子节点卡（贝塞尔连线+关系 pill，>5 仍走侧栏），侧栏改为仅显式点击打开、点其他节点自动隐藏，图谱区占满全宽；中途试做累积探索图后按用户要求回退为单中心替换。邮箱采集器支持多账号、时间线 activityDisplay chips、立即采集错误透出等已随 77821891 提交。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `377ef6a8` | (see git log) |
| `77821891` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 25: New folder/file locate-and-highlight after create

**Date**: 2026-09-29
**Task**: New folder/file locate-and-highlight after create
**Package**: api
**Branch**: `master`

### Summary

Sidebar: insertEntry now inserts at provider sort position (dirs first, name) so optimistic rows don't jump on refresh; confirmNewItem reuses revealPath to select and scrollIntoView the created folder/file. treeUtils tests updated (32 pass), tsc clean.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `0cf7af60` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 26: Email body decoding + HTML preview panel

**Date**: 2026-10-03
**Task**: Email body decoding + HTML preview panel
**Package**: api
**Branch**: `master`

### Summary

邮件正文改为 mailparse 解码（256KB 全文采集，snippet 纯文本 + bodyHtml），时间线新增点击打开的正文预览面板（DOMPurify 净化、纯文本回退），链接统一走 openLinkByMode 策略并修复非 editor 页跳转；扩展发布 folyn-email-collector 0.1.1 到 folyn-extensions 商店。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `8297dd6b` | (see git log) |
| `a13217ed` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 27: 采集记录页样式打磨与采集器筛选

**Date**: 2026-10-03
**Task**: 采集记录页样式打磨与采集器筛选
**Package**: api
**Branch**: `master`

### Summary

采集记录页视觉重构：加载骨架、图标空态、语义色徽章（.cl-badge）、等宽日志面板、展开分隔线；新增采集器多选 chips 筛选（全选/全部切换、noMatch 全宽空态）与分组间分隔线；附带 hooks trace 日志提交并推送。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `5f1320f0` | (see git log) |
| `8c4a6dfb` | (see git log) |
| `fc2a47a1` | (see git log) |
| `9309d481` | (see git log) |
| `57b96984` | (see git log) |
| `facd9490` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 28: Font size 8-28px range for appearance and editor settings

**Date**: 2026-10-03
**Task**: Font size 8-28px range for appearance and editor settings
**Package**: api
**Branch**: `master`

### Summary

外观页界面字体大小与编辑器页字体大小从固定选项改为 8-28px 全量下拉（默认 14/13 不变），setFontSize/setEditorFontSize 及 hydrate 增加 [8,28] clamp，脏配置值被压回范围。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `50ce32bd` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete
