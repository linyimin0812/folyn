# Split oversized P1 files into focused modules

## Goal

消除架构分析发现的 P1 债务：6 个超大源文件拆为聚焦模块，纯代码搬移（零行为变更），降低维护与导航成本。

## What I already know

来自 graphify 架构分析（2026-09-27）：

* TS/TSX 侧：`MarkdownPreview.tsx` 1588 行、`App.tsx` 1247、`PetApp.tsx` 1073
* Rust 侧：`voice/apple_speech.rs` 1431、`lib.rs` 1359、`chat.rs` 1349
* 各文件天然切分线（已勘察）：
  * MarkdownPreview.tsx — rehype 插件、frontmatter 解析、SVG 常量、图片/围栏宽度调整、ResizableMedia、CodeBlockWrapper、VaultImage、主组件
  * App.tsx — 组合根 + useIsMobile/快捷键 hooks + builtin 注册调用
  * PetApp.tsx — 桌宠状态机/精灵渲染/位置持久化
  * apple_speech.rs — SFSpeechRecognizer FFI、SegmentAccumulator、RecognitionLifecycle、CJK 拼接规则（大量独立纯函数）
  * lib.rs — Tauri run() 组合根 + 桌宠窗口 topmost/NSPanel 管理（大段 cfg 双实现）
  * chat.rs — ChatParams/HistoryMode、run_provider_stream、drain_loop、session 持久化（已有 mod image_scanner 子模块先例）
* chat.rs 内含 `mod tests`；TS 侧存在对应 *.test.tsx（PetApp、rpcBridge 等有测试保障）

## Assumptions (temporary)

* 拆分策略 = 纯机械搬移（不改逻辑、不改导出语义），用现有测试 + typecheck 验证
* 帮助函数导出用模块内聚原则，不做额外抽象

## Decision (ADR-lite)

**Context**: 6 个 P1 超大文件如何拆、拆多深。
**Decision**: 6 个全拆（TS 3 + Rust 3），策略为"搬移为主 + 顺手清理"——收拢重复导出、删除搬移后的死代码，但不引入新抽象；除清理项外零行为变更。
**Consequences**: diff 比纯搬移略大，审查时需区分搬移与清理；换来一步到位。

## Requirements

* 6 个文件全部拆分，每个拆后模块 ≤ ~400 行
* 搬移为主 + 顺手清理（收拢重复导出、删除搬移后残留死代码），不引入新抽象
* 除顺手清理项外零行为变更
* 现有测试全部保持通过

## Acceptance Criteria

* [x] 6 个文件各自拆为 ≤ ~400 行的聚焦模块（App.tsx 430 / lib.rs 991 为组合根保留项）
* [x] `tsc -b`（apps/desktop）、`cargo check`（src-tauri）通过
* [x] `cargo test` 231/231 通过
* [x] `pnpm test`：重构前后均为 28 个既有失败（基线 7bca9875 对比），零新增
* [x] git diff 审查确认：逻辑不变，仅搬移、import 调整与标注的清理项

## Definition of Done

* Lint / typecheck / cargo check / 测试全绿
* git diff 审查确认为纯搬移

## Out of Scope

* 不引入新抽象/接口
* 不处理 P2（services/ 扁平化）、P3（escapeHtml 重复）
* 不改任何运行时行为

## Technical Notes

* 切分依据见上；Rust 子模块可沿用 chat.rs `mod image_scanner` 先例
* apple_speech.rs 的 CJK 拼接纯函数群是零风险首选切分块
