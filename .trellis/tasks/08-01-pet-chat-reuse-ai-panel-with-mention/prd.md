# Pet Chat 复用 AiPanel 并支持 @

## Goal

让 pet-panel 窗口的 Chat 标签页直接渲染 `AiPanel` 组件（替代当前的 `PetChat`），从而：
- 消除 PetChat 与 AiPanel 的双实现/双 store/双 service 重复；
- 让 pet 窗口获得 AiPanel 已有的 @ 文件提及能力；
- pet 窗口与主窗口共用同一份 AI 会话（aiStore）。

## What I already know

- **AiPanel** 入口 `apps/desktop/src/components/ai/AiPanel.tsx:22`，在 `App.tsx:640/667` 由 `aiPanelVisible` 闸门挂载。
- **PetPanelApp** 在 `apps/desktop/src/components/pet/PetPanelApp.tsx:496` 的 `tab === 'chat'` 分支渲染 `<PetChat />`。
- **PetChat**（`apps/desktop/src/components/pet/PetChat.tsx`）+ `petChatStore` + `petChatService` 是 AiPanel 的精简变体：独立 store/adapter/service，复用 `ChatInputBox`、`PairSelector`、`attachments.ts` 等基础件，但**无 @ overlay**、**无 vault 耦合**（vault-free by design, PRD R6）。
- **@ 实现自包含在 `ChatInput.tsx`**（42-43/168-231/244-268/338-351 行），文件源来自 `useVaultStore.fileTree` → `flattenFileTree` → `allFiles`，发送侧再由 `AiPanel.tsx:196-208` 正则重扫 prompt 提取 `@file` 路径。
- **vaultStore 没有注册为持久化 slice**（只有 `vaultConfigStore` 注册），`fileTree` 是 runtime 状态，不进入 `pet://settings-updated` 广播包。
- **pet-panel 窗口 fs ACL**（`capabilities/pet-panel.json`）：只有 `fs:scope-appdata-recursive`，没有 vault 路径权限。`vaultStore.refreshFileTree()` 在 pet 窗口会失败（fs 读 vault 路径被拒）。
- **AiPanel 关闭按钮**（`AiPanel.tsx:378`）调用 `toggleAiPanel`（`useEditorViewStateStore`），在 pet 窗口语义不通；pet 窗口已有自己的面板级 × 关闭按钮（`PetPanelApp.tsx:489`）。
- **AiPanel 根 div 样式**（`AiPanel.tsx:335`）：`shrink-0 border-l` + 固定 `panelWidth`（380px，可拖拽 resize）。pet 窗口 body 已有自己的尺寸/resize，直接嵌入会双重堆叠。
- **跨窗口 store 同步**：`pet://settings-updated` 广播 blob → `hydrateAllStores` 分发到所有注册 slice。pet 窗口持独立 zustand 实例。

## Assumptions (temporary)

- pet 窗口与主窗口**共用同一份 aiStore 会话**是期望行为（"共用"语义）。
- 现有 pet 会话（`pet-chat:sessions` 命名空间）**不做迁移**，删除 `petChatStore` 时丢失（ ponytail：迁移是 over-kill）。
- pet 窗口的 `useEditorStore` active tab 路径为 `undefined` → @ 提及的"优先当前文件"无优先项，@ 仍能用，只是不置顶当前文件。可接受。

## Open Questions

无（全部已决，见 Decision）。

## Requirements

- pet-panel `tab === 'chat'` 渲染 `<AiPanel embedded />`，不再渲染 `<PetChat />`。
- AiPanel 新增 `embedded?: boolean` prop，嵌入时：
  - 跳过 `if (!aiPanelVisible) return null` 闸门；
  - 隐藏头部 × 关闭按钮（不调用 `toggleAiPanel`）；
  - 隐藏左侧 resize 把手；
  - 根 div 改为 `w-full`、无 `border-l`、无固定 `panelWidth`、无 `shrink-0`。
- 主窗口订阅 `vaultStore.fileTree` 变化，`emit('pet://file-tree-updated', { currentVault, fileTree })`，debounce ~300ms。
- pet 窗口监听 `pet://file-tree-updated`，`useVaultStore.setState({ currentVault, fileTree })`。
- pet 窗口的 AiPanel 中 @ 文件提及可用：文件列表来自镜像的 fileTree。
- 删除 `PetChat.tsx`、`PetChatSessionHeader.tsx`、`petChatStore.ts`、`petChatService.ts`（及对应测试与导入）。
- `PetPanelApp` 导入改为 `AiPanel`，移除 `PetChat` 导入。

## Acceptance Criteria (evolving)

- [ ] pet-panel 切到 Chat 标签页渲染的是 AiPanel（有会话切换/新建/删除、Chat/Agent/Ask 模式切换、PairSelector）。
- [ ] pet 窗口输入 `@` 弹出文件提及菜单，文件列表来自当前 vault 的 fileTree。
- [ ] 选中提及项后插入文件 chip，发送时 prompt 含 `请先使用 Read 工具读取以下文件` 前缀。
- [ ] pet 窗口 AiPanel 无 × 关闭按钮、无左侧 resize 把手、填满 body 宽度。
- [ ] pet 窗口与主窗口共享同一份 aiStore 会话（在主窗口新建会话，pet 窗口可见，反之亦然）。
- [ ] `PetChat.tsx` / `petChatStore.ts` / `petChatService.ts` 及测试已删除，`grep -r 'petChatStore\|petChatService\|PetChat'` 在 `apps/desktop/src` 无残留（除可能的 i18n key）。
- [ ] `pnpm typecheck` + `pnpm lint` + 受影响测试通过。

## Definition of Done

- 类型检查 / lint / 受影响测试绿。
- pet 窗口实测：打开 Chat 标签、发消息、@ 一个文件、发送，整条链路工作。
- 主窗口与 pet 窗口的 aiStore 会话一致性实测。
- 无 PetChat 残留代码。

## Out of Scope (explicit)

- 现有 pet 会话（`pet-chat:sessions`）向 aiStore 迁移——不迁移，接受丢失。
- pet 窗口里的 AiPanel study-session 集成（`isStudySession` 分支）——保持 AiPanel 现有行为，不在本任务扩展。
- pet 窗口 vault fs ACL 扩展（不通过 shell 提权或新增 fs scope）。
- pet 窗口独立的 fileWatcher——不做，依赖主窗口广播。

## Technical Approach

**Approach B + 嵌入模式 + 全删 PetChat 套件**：

1. **AiPanel 加 `embedded?: boolean`**（`AiPanel.tsx`）：`embedded` 时跳过 `aiPanelVisible` 闸门、隐藏 × 与 resize 把手、根 div 样式改为 `w-full` 无 `border-l` 无 `panelWidth`。其他逻辑不动。
2. **PetPanelApp 切换**（`PetPanelApp.tsx:496`）：`tab === 'chat' ? <AiPanel embedded />`，移除 `PetChat` 导入。
3. **fileTree 广播**（`vaultStore.ts` + `PetPanelApp.tsx`）：
   - 主窗口侧：在 `vaultStore` 模块底部用 `subscribeFileTree`（已存在，`vaultStore.ts:571`）订阅 fileTree 变化，debounce 300ms 后 `emit('pet://file-tree-updated', { currentVault, fileTree })`。主窗口独有，pet 窗口的 vaultStore 实例不订阅（避免回环）。
   - pet 窗口侧：`PetPanelApp` 加一个 `useEffect` 监听 `pet://file-tree-updated`，`useVaultStore.setState({ currentVault, fileTree })`。
   - 触发点：vault 连接/断开、文件变更（fileWatcher）、`refreshFileTree` 调用后——都走 `subscribeFileTree` 回调。
4. **删除**：`PetChat.tsx`、`PetChatSessionHeader.tsx`、`petChatStore.ts`、`petChatService.ts`、`petChatStore.test.ts`、`petChatService.test.ts`、`PetChat.test.tsx`，以及 `PetPanelApp.test.tsx` 中对 PetChat 的引用（改测 AiPanel 渲染）。
5. **i18n**：检查 `pet:` 命名空间下 PetChat 专属 key，无引用则删；AiPanel 已有 `ai:` key 复用。

## Decision (ADR-lite)

- **Context**: PetChat 与 AiPanel 双实现漂移；用户要"共用 AI Panel 页面，支持 @"。pet 窗口 vault-free（PRD R6）与 AiPanel vault 耦合冲突。
- **Decision**:
  - Approach B（主窗口广播 fileTree）——复用 `pet://settings-updated` 同款事件模式，无 fs ACL/Rust 改动。
  - AiPanel 加 `embedded` prop 隐藏 ×/resize/宽度，填满 pet body。
  - 全删 PetChat/PetChatSessionHeader/petChatStore/petChatService，不留回退。
- **Consequences**:
  - pet 窗口会话并入 aiStore（与主窗口共享），原 pet 会话（`pet-chat:sessions`）丢失——可接受。
  - pet 窗口 fileTree 落后主窗口 ~300ms（debounce）——可接受。
  - pet 窗口 AiPanel 的 `refreshFileTree()`（stream done 时调用）会失败被 catch 吞掉——无害，fileTree 由广播维护。
  - `useEditorStore` active tab 在 pet 窗口为 undefined——@ 提及无"当前文件置顶"，行为退化但可用。

### vault 耦合的解法对比（已决策，见上 ADR；保留备查）

**Approach A: 给 pet-panel 窗口加 vault fs ACL** — 否决（需 Rust 动态 scope）。
**Approach B: 主窗口广播 fileTree 到 pet 窗口** — **采纳**。
**Approach C: 不解决，接受 @ 列表空** — 否决（违背需求）。

## Technical Notes

- 关键文件：
  - `apps/desktop/src/components/ai/AiPanel.tsx:22` — 加 `embedded?` prop
  - `apps/desktop/src/components/pet/PetPanelApp.tsx:496` — 换 `<AiPanel embedded />` + 加 fileTree 广播监听
  - `apps/desktop/src/store/vaultStore.ts:571` — `subscribeFileTree` 已存在，主窗口侧 emit 钩子
  - 删除：`apps/desktop/src/components/pet/PetChat.tsx`、`PetChatSessionHeader.tsx`、`apps/desktop/src/store/petChatStore.ts`、`apps/desktop/src/services/petChatService.ts` + 对应 test
- @ 实现位置：`apps/desktop/src/components/ai/ChatInput.tsx`（自包含，随 AiPanel 复用带入 pet 窗口，无需改动）。
- `useEditorStore` active tab 在 pet 窗口为 undefined——@ 提及的"当前文件置顶"无置顶，行为退化但可用。
- fileTree 广播通道：`pet://file-tree-updated`，payload `{ currentVault, fileTree }`，debounce 300ms。

## Research References

- `research/` — 无外部研究，全部基于代码内探索。
