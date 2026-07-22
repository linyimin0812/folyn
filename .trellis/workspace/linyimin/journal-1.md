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

Added a desktop pet mode to Quill: a transparent always-on-top Tauri window with an ink-drop + quill-tip SVG mascot (4 CSS/SVG states: idle/hover/drag/click). Single-click focuses the main window; right-click opens a native popup context menu (Show Main Window / New Note / Toggle AI Panel / Disable Pet Mode). Toggle via View-menu checkable item (Cmd+Shift+P) with bidirectional checkmark sync. Position persisted to settingsStore and restored on launch. Click-through on transparent regions via setIgnoreCursorEvents polling. Auto-hide when the main window is fullscreen. CloseRequested hides main instead of quitting while pet visible. Captured reusable patterns in a new spec (tauri-window-patterns.md: ACL permission contract, native popup menu, close-to-tray, click-through). Merged to master and pushed to origin.

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
