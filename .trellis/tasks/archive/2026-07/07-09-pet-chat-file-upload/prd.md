# PetChat 文件上传

## Goal

为桌宠 chat 增加文件上传能力：用户可在 pet chat 消息中附带磁盘文件（与/或粘贴图片），AI 经 Read 工具读取。复用上一任务在共用 `ChatInputBox` 预留的附件插槽（`attachmentsRow`/`leadingSlot`/`onPaste` 等），参照 AiPanel 的附件实现，但适配 pet 的无 vault 语境（附件落盘到 pet 的 appData temp cwd，而非 vault `.quill-tmp`）。

## What I already know

- 共用 `components/chat/ChatInputBox` 已预留附件能力（PR2 为 AiPanel 增补）：`leadingSlot`（文件选择按钮 + inputMode 下拉）、`attachmentsRow`（附件 chip 行）、`overlayLayer`（@mention 浮层 + 模式菜单）、`onBeforeKeyDown`、`onPaste`、`canSend`、`inputRef`。PetChat 当前**全部省略**。
- AiPanel `components/ai/ChatInput.tsx` 是参照实现：`PendingAttachment = {id, name, type:'image'|'file', path?, blob?, previewUrl?}`；粘贴图片（`handlePaste`）、文件选择（hidden `<input type=file multiple accept=...>`）、@mention（`flattenFileTree(vaultStore.fileTree)` 过滤）；blob 落盘 `<vault>/.quill-tmp/img-<ts>-<rand>.<ext>`（base64 经 shell 解码）；发送时图片/文件分别前缀 `请先使用 Read 工具读取以下图片/文件:\n<paths>`。
- PetChat 现状（多 session 任务后）：`petChatStore` sessions 模型；`petChatService` per-session adapter + `resumeSessionId` + `bare:true` + cwd=`<appData>/pet-chat-tmp`；PetChat 用共用 `ChatInputBox` 仅传 base props。
- Pet **无 vault**：`vaultStore` 不在 pet-panel 窗口 bundle；故 **@mention 列举 vault 文件不可行**（无 fileTree 来源）。
- Pet `bare:true` 仅控制系统提示/不注入 vault 材料，与「消息正文里加 Read 指令 + 路径」正交（AiPanel 也是把 Read 指令拼进用户消息正文，非 system prompt）。
- pet-panel 窗口 ACL：已有 `shell:allow-spawn/stdin-write/kill`（claude sidecar）+ appData 范围 `fs:allow-mkdir/exists/read-file/read-text-file/write-file/write-text-file/create-app-specific-dirs/scope-appdata-recursive`（见 tauri-window-patterns.md）。写 appData temp + 让 CLI Read 该路径应在 ACL 范围内（CLI 进程读文件不经过 Tauri ACL，是 OS 级）。
- `pet-chat-tmp` cwd 已由 `petChatService.resolveWorkingDir()` 创建于 appData。

## Assumptions (temporary)

- 范围 = 文件选择 + 粘贴图片（不 含 @mention vault 文件，因无 vault）。
- 附件落盘到 pet 现有 cwd `<appData>/pet-chat-tmp/`（复用，不另开目录）。
- 复用 AiPanel 的 `PendingAttachment` 形状与 Read 指令拼接逻辑（抽取或镜像）。
- pet 仍 vault-free：不引入 vaultStore 耦合、不引入 wiki/clip、不引入 inputMode 下拉（pet 无 mode 概念）。

## Decision (ADR-lite) — 上传范围

**Context**: 确定附件能力范围，平衡对标 AiPanel 与 pet 无 vault 约束。
**Decision**: 方案 A —— 文件选择 + 粘贴图片，不含 @mention（pet 无 vault，无 fileTree 来源）。
**Consequences**: 覆盖「丢文件/截图给 AI」主场景；@mention vault 文件明确不做；pet 仍 vault-free（不耦合 vaultStore）。

## Decision (ADR-lite) — 附件复用方式

**Context**: AiPanel ChatInput 含完整附件逻辑但耦合 vaultStore（@mention），pet-panel 窗口不能 import 它。
**Decision**: 方案 A —— 抽取 vault-free 的共用附件 helper 到 `components/chat/`（`useFileAttachments(workingDir)` 或 `attachments.ts`：`PendingAttachment` 类型 + `addFiles`/`handlePaste`/`saveBlobs`/`buildReadInstructions`）。AiPanel ChatInput 与 PetChat 都改用它；@mention 仍留各自 wrapper。
**Consequences**: DRY、正确抽象边界（helper 不 import vaultStore，pet-panel 隔离不破）；代价：需把 AiPanel 现有附件逻辑重构进 helper 并保持其行为不变。

## Open Questions

- （已收敛，无阻塞；护栏数值见 Requirements，可在最终确认时调整。）

## Requirements

- **共用附件 helper**：新建 `apps/desktop/src/components/chat/attachments.ts`（或 `useFileAttachments(workingDir)`），vault-free（**不 import vaultStore/editorStore/aiStore**），提供：
  - `PendingAttachment` 类型（`{id, name, type:'image'|'file', path?, blob?, previewUrl?, sizeBytes}`）。
  - `addFiles(fileList)` / `handlePaste(clipboardEvent)`（识别图片）。
  - `saveBlobs(workingDir)`：blob 附件落盘到 `<workingDir>/attachments/`，返回 `{path, type}[]`；path 附件直通。
  - `buildReadInstructions(attachments)`：图片/文件分组拼 `请先使用 Read 工具读取以下图片/文件:\n<paths>` + `\n\n用户消息: <prompt>`（对标 AiPanel）。
  - `validateFile(file)`：大小上限（默认 10MB/文件）+ 类型白名单（对标 AiPanel `accept`：`image/*` + `.txt/.md/.json/.csv/.html/.xml/.yaml/.yml/.log/.pdf` 等），超限/非白名单返回错误信息供 UI 提示。
- **AiPanel 接入**：`components/ai/ChatInput.tsx` 重构为使用该 helper（@mention 仍留 wrapper，因耦合 vaultStore）；行为不变。
- **PetChat 接入**：`PetChat.tsx` 用共用 `ChatInputBox` 的 `leadingSlot`（文件选择按钮 + hidden file input）、`attachmentsRow`（chip 行 + 移除）、`onPaste`（粘贴图片）、`canSend`（`input.trim() || attachments.length>0`，对齐 AiPanel）；无 `overlayLayer`/@mention。发送时 `saveBlobs(workingDir)` → `buildReadInstructions` → 拼进用户消息正文 → `sendPetChatMessage(sessionId, finalPrompt, handlers)`。
- **落盘**：blob 写 `<appData>/pet-chat-tmp/attachments/`（pet workingDir 子目录，复用 `petChatService` 的 cwd 体系；AiPanel 仍用 `<vault>/.quill-tmp/`，由各自传入的 workingDir 决定）。
- **护栏**：超 10MB/文件或非白名单类型 → 不加入附件 + 内联提示（不 `alert()`）；可在最终确认调数值。
- **生命周期**：附件 per-send 临时态，发送成功后清空；chip 可单独移除；session 切换/删除时既有 stop 逻辑不变（附件为输入态，不持久）。
- **约束保留**：`bare:true`、appData cwd、独立 pet-panel 窗口、不顶层 import vaultStore/editorStore/aiStore；@mention/wiki/clip/inputMode 不做。

## Acceptance Criteria

- [ ] 文件选择按钮可加磁盘文件为附件；粘贴图片可加为附件；chip 可移除。
- [ ] 超大小上限/非白名单类型被拒并内联提示。
- [ ] 发送时 blob 落盘到 appData temp，消息正文含 Read 指令 + 路径；AI 能读取（路径可达）。
- [ ] 发送成功后附件清空。
- [ ] `canSend` 允许仅附件发送（空文本 + 有附件可发）。
- [ ] AiPanel 附件行为与重构前一致（粘贴/选择/@mention/Read 指令/落盘到 vault .quill-tmp）。
- [ ] 不破坏 PetChat 既有 send/stop/clear/session/unmount/copy 行为。
- [ ] helper 无 vaultStore/editorStore/aiStore 顶层 import（grep 校验）。
- [ ] typecheck + PetChat/AiPanel 既有测试通过 + 新增 helper/附件测试通过。

## Definition of Done (team quality bar)

- 测试更新且通过（helper 单测 + PetChat 附件测试 + AiPanel 回归）。
- Lint / typecheck / CI green。
- 行为/约束变化记录于任务 notes（vault-free 约束重新界定为「不耦合 vaultStore，但支持磁盘文件附件经 appData temp」）。
- 若附件 helper 有可复用契约，更新 spec。

## Out of Scope (explicit)

- @mention vault 文件（pet 无 vault；AiPanel 的 @mention 仍由其 wrapper 自管，不进 helper）。
- wiki/clip、inputMode 下拉、markdown、工具调用 UI。
- 附件持久化/跨 session 保留、附件预览增强（仅复用既有 img preview/FileImage）。
- 不改 `bare:true` 语义、不改 pet session/adapter 模型。
- 不改共用 `ChatInputBox` 内部（仅接线其既有插槽）。

## Technical Approach

1. **Helper**：`components/chat/attachments.ts` 纯函数 + 类型，`saveBlobs` 用 plugin-fs 写 appData（或参照 AiPanel shell 方式，择优）；`validateFile` 大小/类型护栏。
2. **PetChat**：本地 `attachments` state + `useFileAttachments` 风格；填 `ChatInputBox` 的 `leadingSlot`/`attachmentsRow`/`onPaste`/`canSend`；`handleSend` 在 `addMessage` 前组装 `finalPrompt`（Read 指令 + 用户文本）。
3. **AiPanel**：`ChatInput.tsx` 改用 helper 的 `addFiles/handlePaste/saveBlobs/buildReadInstructions/validateFile`；@mention 逻辑保留在 wrapper；行为不变。

## Implementation Plan (small PRs)

- PR1: 共用 `components/chat/attachments.ts` helper + `PendingAttachment` + 落盘/Read 指令/护栏 + 单测（不接线）。
- PR2: PetChat 接入 helper（文件选择 + 粘贴 + Read 指令 + canSend + 护栏提示）+ 既有测试更新 + 附件测试。
- PR3: AiPanel ChatInput 重构为使用 helper（@mention 留 wrapper，行为不变）+ 既有测试回归。

## Technical Notes

- 关键文件：`apps/desktop/src/components/pet/PetChat.tsx`、`apps/desktop/src/services/petChatService.ts`、`apps/desktop/src/components/chat/ChatInputBox.tsx`（插槽）、`apps/desktop/src/components/ai/ChatInput.tsx`（参照实现）。
- 上一任务 research：`.trellis/tasks/07-09-desktop-pet-chat-and-ai-panel-shared-ui/research/input-and-streaming.md`（AiPanel 附件/发送流程细节）。
- ACL 参考：`.trellis/spec/desktop/frontend/tauri-window-patterns.md`（pet-panel shell/fs 权限）。
