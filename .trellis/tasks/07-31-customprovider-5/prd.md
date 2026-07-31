# 清除 customProvider 死字段与 5 处拼参块

## Goal

ADR-0002 明记 Rust 侧 `custom_provider` 字段已死（serde 默认丢弃），
但前端 `ResolvedPairConfig.customProvider` + 多处 `customProvider` 拼参块仍在发送与扩散。
本次任务把"死发送 + 其级联"清干净，让 `runRigChat` / `fetchModelsRaw` 接口变深，
调用方不再手写 `cfg.customProvider ? { customProvider: true, adapterFamily: ... } : {}` 拼参块。
持久化层的 `ProviderSettings.customProvider` 标志**不在本次范围**（ADR 未涉及，影响面大）。

## What I already know

### Rust 侧（已死，无需改）
- `src-tauri/src/chat.rs:99-107` `ChatParams` 无 `custom_provider` 字段；注释 :103-105 自陈"frontend still sends a customProvider flag for semantic clarity; serde ignores it"。
- `src-tauri/src/list_models.rs:22-28` 同样丢弃；注释 :25-26 自陈"frontend's customProvider flag is silently ignored by serde"。
- ADR-0002 :14 明记"custom_provider Rust field is dead"。

### TS 侧——Rust-facing 死发送（直接删除）
- `services/rigChat.ts:51,99` — `RigChatParams.customProvider?` + `customProvider: p.customProvider ?? false`（在 `invoke('chat_stream', { params: {...} })` 里发送，Rust 丢弃）。
- `services/rigChat.ts:131,137,156` — `testChatConnection` 的 `customProvider?` 形参 + 解构 + 透传到 `runRigChat`（级联）。
- `services/modelRegistry/fetchModels.ts:25,52` — `customProvider?` + `customProvider: customProvider ?? false`（invoke 发送，Rust 丢弃）。

### TS 侧——`ResolvedPairConfig.customProvider` 级联（删字段 + 改调用方）
- `store/aiConfigStore.ts:125-136` `ResolvedPairConfig.customProvider: boolean` + `adapterFamily?: string`。
- `store/aiConfigStore.ts:159-168` `resolvePairConfig` 设 `customProvider: custom`（`!!state.customerProviders[pair.provider]`）与 `adapterFamily`。
  - 关键不变式：**`customProvider === true` ⟺ `adapterFamily != null`**（同源：`state.customerProviders[pair.provider]`）。
- 5 个调用方：
  1. `services/plugin-host/aiCapability.ts:92` — 条件展开 `...(cfg.customProvider ? { customProvider: true, adapterFamily: cfg.adapterFamily } : {})` → 改为 `adapterFamily: cfg.adapterFamily`。
  2. `components/settings/BubbleTemplateAIChatModal.tsx:312` — 同上条件展开。
  3. `components/ai/AiPanel.tsx:305` — 直传 `customProvider: resolved.customProvider` → 删除该行（adapterFamily 已在下一行传递）。
  4. `hooks/useVoiceInput.ts:266` — 直传 → 删除该行。
  5. `services/petChatService.ts:231` — 直传 → 删除该行。

### TS 侧——`modelRegistryStore` 链路（含 1 处真用 logic）
- `store/modelRegistryStore.ts:49,61,110,116,208` — `fetchModelsForProvider` 的 `customProvider` 形参 + 透传到 `fetchModelsRaw` + `configured.map(c => ...c.customProvider...)` 调用。
- `store/modelRegistryStore.ts:134` — `const isCustom = customProvider === true;` → 用于 owner-map 的 group enrichment（:145 `...(isCustom ? { group: m.group ?? entry?.providerId } : {})`）。**这是真逻辑，不是纯 indirection。** 替换：`const isCustom = adapterFamily != null;`（由前述不变式保证等价）。

### 测试需要更新
- `store/aiConfigStore.test.ts:859` — `expect(resolved!.customProvider).toBe(false);` 删除（字段不再存在）。
- 其他 aiConfigStore.test.ts 多处 `customProvider: true/false` 是对 `ProviderSettings.customProvider` 的断言——**保留**（持久化层字段不动）。
- `services/rigChat.test.ts` / `services/petChatService.test.ts` / `services/plugin-host/aiCapability.test.ts` / `components/settings/BubbleTemplateAIChatModal.test.tsx` — 若有 `customProvider` 透传断言，删除。

## Assumptions (temporary)

- 删除 `ResolvedPairConfig.customProvider` 后，所有调用方都能仅靠 `adapterFamily` 表达——验证：`adapterFamily` 对 bundled provider 为 `undefined`，Rust `chat.rs` `resolve_adapter_family` 会 `unwrap_or(provider.as_str())`，行为不变。
- `modelRegistryStore.ts:134` 的 `isCustom` 用 `adapterFamily != null` 替换后，行为等价——验证：custom ⇔ `adapterFamily != null` 由 `resolvePairConfig` 不变式保证。
- `ProviderSettings.customProvider`（持久化层）保持不动，不在本次范围。

## Open Questions

- 已收敛（见 Decision 节）。

## Decision (ADR-lite)

**Context**: 用户选择"连 `ProviderSettings.customProvider` 一起删"。
探查发现该字段在 production 代码中**从不被读取**——所有"是否 custom"判断都走 `state.customerProviders[id] != null`。
该字段仅在 `providerConfigStorage.ts` 的 migration / `emptySettings` seed 与 `aiConfigStore.ts:emptySettings` seed 写入，加上测试断言。

**Decision**: **Approach A — 干净删除**。
- 删 `ProviderSettings.customProvider` 接口字段（`providerConfigStorage.ts:46`）。
- 删 `aiConfigStore.ts:emptySettings(id, customProvider = false)` 的第二形参 → 变 `emptySettings(id)`。
- 删 `providerConfigStorage.ts:emptySettings(id)` 内的 `customProvider: false` seed。
- 删 `migrateLegacyBlob` 内所有 `customProvider: true/false`（5 处：:286, :380, :400, :420, :435）+ 注释 :344-345。
- 删 `aiConfigStore.ts` 中所有 `emptySettings(id, true/false)` 调用的第二实参（:75, :79, :80, :340, :515, :551）。
- 持久化层无需 migration pass：hydrate 的 unknown-key guard 静默丢弃旧 `customProvider` 字段（与 ADR-0002 :16 描述的 `defaultChatEndpoint` 同路径）。

**Consequences**:
- storage.json 中残留的 `customProvider: true/false` 会被 hydrate 静默丢弃，无用户可见行为变化。
- 未来 reader 不会因为 `ProviderSettings.customProvider` 字段存在而误以为有 production 逻辑分支。
- 测试 fixture 中所有 `customProvider: true/false` 行删除（~14 处）。
- `ResolvedPairConfig.customProvider` 与 `RigChatParams.customProvider` / `fetchModels.customProvider` 一并删除。

## Requirements (evolving)

### A. Rust-facing 死发送删除
- 删除 `RigChatParams.customProvider` 字段与 `rigChat.ts:99` 的 `customProvider: p.customProvider ?? false` 发送。
- 删除 `testChatConnection` 的 `customProvider` 形参与透传（rigChat.ts:131,137,156）。
- 删除 `fetchModels` 的 `customProvider` 形参与 `fetchModels.ts:52` 发送。

### B. `ResolvedPairConfig.customProvider` 删除 + 5 调用方改写
- 删除 `ResolvedPairConfig.customProvider` 字段；`resolvePairConfig` 不再设该字段（aiConfigStore.ts:131,166）。
- 5 调用方：
  1. `aiCapability.ts:92` 条件展开 → `adapterFamily: cfg.adapterFamily`
  2. `BubbleTemplateAIChatModal.tsx:312` 条件展开 → `adapterFamily: cfg.adapterFamily`
  3. `AiPanel.tsx:305` 删除 `customProvider: resolved.customProvider` 行
  4. `useVoiceInput.ts:266` 删除该行
  5. `petChatService.ts:231` 删除该行

### C. `modelRegistryStore` 链路改写
- `fetchModelsForProvider` 删除 `customProvider` 形参（modelRegistryStore.ts:49,61,110,116）。
- `:134` 改 `const isCustom = adapterFamily != null;`（由 `resolvePairConfig` 不变式保证等价）。
- `:208` 调用方移除该实参。
- `refetchAll` 的 `configured` 类型移除 `customProvider?: boolean` 字段。

### D. `ProviderSettings.customProvider` 持久化层删除
- 删 `ProviderSettings.customProvider: boolean` 字段（providerConfigStorage.ts:46）。
- `emptySettings(id)`（providerConfigStorage.ts:279-288）删 `customProvider: false` seed（:286）。
- `emptySettings(id, customProvider = false)`（aiConfigStore.ts:50）→ `emptySettings(id)`；删 `customProvider` 字段（:57）。
- `migrateLegacyBlob` 删 5 处 `customProvider: true/false`（:286→已是 emptySettings 内, :380, :400, :420, :435）+ 注释 :344-345。
- `aiConfigStore.ts` 所有 `emptySettings(id, true/false)` 调用变 `emptySettings(id)`（:75, :79, :80, :340, :515, :551）。
- `catalog.ts:43` 注释中的 `customProvider: true +` 改为仅 `adapterFamily`。

### E. 测试更新
- `aiConfigStore.test.ts` — 删 :242, :335-336, :424, :542, :551, :598, :847, :859, :884 的 `customProvider` 断言。
- `aiStore.test.ts:440` — 删 `customProvider: false` 行。
- `PairSelector.test.tsx` — 删 :50, :71, :80, :103, :113, :123, :145, :171, :202, :230, :239 共 11 处 `customProvider` 行。
- `BubbleTemplateAIChatModal.test.tsx` — 删 :43, :74, :161 共 3 处。
- `petChatService.test.ts:393` — 删 `customProvider: false` 行（ResolvedPairConfig fixture）。
- `providerConfigStorage.test.ts` — 删 :35, :54, :98, :121 共 4 处 `customProvider` 断言。

## Acceptance Criteria (evolving)

- [ ] `pnpm typecheck` 绿（无 `customProvider` 字段引用残留）。
- [ ] `pnpm test` 全绿（更新后的测试通过）。
- [ ] `rg "customProvider" apps/desktop/src/services apps/desktop/src/components/ai apps/desktop/src/components/settings apps/desktop/src/hooks apps/desktop/src/store/aiConfigStore.ts apps/desktop/src/store/modelRegistryStore.ts` 命中仅剩 `ProviderSettings.customProvider` 相关（持久化层）。
- [ ] 手测：bundled provider 发 chat → 正常；custom provider（如 OpenAI-compat 网关）发 chat → 正常；list-models 在 custom provider 上 enrichment group 仍生效。

## Definition of Done

- 单测更新（aiConfigStore.test / rigChat.test / petChatService.test / aiCapability.test / BubbleTemplateAIChatModal.test）
- typecheck + lint 绿
- ADR-0002 不更新（本任务是其后续落地，不修改决策）
- 不改 Rust 侧（字段早已删除）

## Out of Scope (explicit)

- Rust 侧 `chat.rs` / `list_models.rs` 改动（字段早已删除，无需改）。
- 持久化 storage.json 中残留 `customProvider` 字段的 migration pass（hydrate unknown-key guard 静默丢弃，与 ADR-0002 :16 同路径）。
- 候选 02–05（FileChangeApplier 合并 / aiStreamUtils 深化 / VaultProvider 接口删除 / 路径表统一）——独立任务。

## Technical Notes

### 关键不变式（删除安全性依据）
`ResolvedPairConfig.customProvider === true` ⟺ `adapterFamily != null`
- 两者同源：`state.customerProviders[pair.provider]`。
- `customProvider = !!state.customerProviders[pair.provider]`（aiConfigStore.ts:159）
- `adapterFamily = state.customerProviders[pair.provider]?.adapterFamily`（:167）
- 因此 `adapterFamily != null` 是 `customProvider === true` 的等价替换式。

### Rust 侧行为（无需改）
- `chat.rs` `resolve_adapter_family(&params).unwrap_or(params.provider.as_str())`：`adapter_family` 为 None 时回落到 `provider`，与旧行为一致。
- `list_models.rs` 同一逻辑。

### 变更面（7 个源文件 + ~5 个测试文件）
- `apps/desktop/src/services/rigChat.ts`
- `apps/desktop/src/services/modelRegistry/fetchModels.ts`
- `apps/desktop/src/store/aiConfigStore.ts`
- `apps/desktop/src/store/modelRegistryStore.ts`
- `apps/desktop/src/services/plugin-host/aiCapability.ts`
- `apps/desktop/src/services/petChatService.ts`
- `apps/desktop/src/components/ai/AiPanel.tsx`
- `apps/desktop/src/components/settings/BubbleTemplateAIChatModal.tsx`
- `apps/desktop/src/hooks/useVoiceInput.ts`
- 测试：aiConfigStore.test / rigChat.test（如存在）/ petChatService.test / aiCapability.test / BubbleTemplateAIChatModal.test

### ADR 引用
- `docs/adr/0002-custom-provider-adapter-family-direct.md:14` 明记 `custom_provider` Rust field 已死、TS-side `ResolvedPairConfig.customProvider` 仅为 conditional spread 保留。
