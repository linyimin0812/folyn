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
