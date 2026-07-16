# split settingsStore god-store

## Goal

把 `apps/desktop/src/store/settingsStore.ts`（618 行 / 44 setter / 7 关注点 god-store）
全量拆成 8 个内聚 store，消灭 `updateSettings(Partial<SettingsState>)` 跨关注点逃生舱。
纯重构：字段语义/默认值/持久化键/回填逻辑零变更，老用户重启零感知。

## Decision (ADR-lite)

**Context**: settingsStore 混 7 个无关关注点；`updateSettings(Partial<SettingsState>)`
让任意消费者跨关注点写任意字段。审计最强的"re-render 爆炸半径"理由对 Zustand
细粒度 selector 不成立（66 消费者几乎全用 `useSettingsStore((s)=>s.field)`，仅
SettingsPage 2 处全量订阅），故本重构价值是**内聚 + 消灭逃生舱 + 为后续 sync/pet
任务铺路**，非性能。

**Decision**：
- **全量拆 8 store**（用户选 Approach A）：
  1. `navStore` — `currentPage`, `settingsTab`（运行时态，不持久化）
  2. `appearanceStore` — theme/fontSize/lineHeight/showAiPanel/showStatusBar/showHiddenFiles/enable{Wiki,Clips,Analyze,Daily}Panel/excludePatterns/linkOpenMode/vaultName
  3. `editorPrefsStore` — editorFont/editorFontSize/tabSize/wrapColumn/showLineNumbers/syntaxHighlight/autoSave/spellCheck
  4. `vaultConfigStore` — vaultPath/imagePath/docExtension/watchFileChanges/trashOnDelete
  5. `syncStore` — syncMethod/Endpoint/AccessKey/SecretKey/Bucket/autoSync/e2eEncrypt
  6. `aiConfigStore` — cliAdapter/cliPath/chatProvider/chatModel/chatApiKey/chatBaseUrl
  7. `prefsStore`（templates+shortcuts）— dailyNotesDir/dailyNoteDateFormat/fileTemplates/shortcuts
  8. `petStore` — petModeEnabled/petPosition*/petPanel*/petIcon*/petSize*/petSize/notificationForm
- **boardColumns 折进 `scheduleStore`**（schedule 域小切片）。
- **AI 配置、Vault 配置开独立新 store**，不折进现有 `aiStore`/`vaultStore`（避免把
  god-store 问题搬家到内容/session 态 store）。
- **持久化单文件 `settings:all` + 扇出加载器**：一个 loader 读老 blob，按字段分发
  各 store；每 store 注册自己的 PERSIST 切片。零数据迁移。
- **彻底删 `updateSettings`**：41 处调用全换对应 store 专用 setter。

**Consequences**: 66 消费者全量迁移（机械 churn 大但低风险）；scheduleStore/aiStore/
vaultStore 内容态不动；持久化仍是单 writer 单文件，pet 拖拽的防抖写盘行为不变。

## Requirements

- 新建 8 个 store 文件，各自定义 state 接口 + 专用 setter（无 `update(partial)` 逃生舱）。
- `boardColumns` + 其 4 个 setter（addBoardColumn/renameBoardColumn/reorderBoardColumns/setBoardColumns）
  迁入 `scheduleStore`。
- 扇出加载器：读 `settings:all` blob → 各 store `set()` 自己切片；运行时态（navStore）
  不参与持久化。
- 回填逻辑归位：`backfillDefaultShortcuts` → prefsStore；`backfillBuiltinExcludePatterns`
  → appearanceStore；在扇出加载器里按切片调用。
- `updateSettings` 41 处调用全替换为专用 setter：
  - SettingsPage 内单字段写入 → 对应 store 的 `setX(v)`。
  - `scheduleLink.ts:218` / `ContextMenu.tsx:140` → `appearanceStore.setShowAiPanel(true)`。
  - `StudyWorkbenchPage.tsx:79` → `navStore.setCurrentPage('editor')`。
  - `vaultStore.ts:95` → `vaultConfigStore.setVaultPath(config.basePath)`。
- 66 个消费者 import 从 `settingsStore` 改到对应 store；selector 形状不变。
- 删除旧 `settingsStore.ts`（或留 re-export shim 一周期后删——见 Out of Scope）。
- 拆 `settingsStore.test.ts` 到各 store 的 sibling test。

## Acceptance Criteria

- [ ] 8 个新 store + scheduleStore 扩展 boardColumns 全部存在，各自有专用 setter，无 `update(partial)`。
- [ ] `updateSettings` 符号在整个 `apps/desktop/src` 中 0 命中（除可能的迁移注释）。
- [ ] 扇出加载器从单 `settings:all` blob 正确 hydrate 所有 store；运行 `pnpm test`
      含持久化 round-trip 测试绿。
- [ ] 老用户数据兼容：用现存 `settings:all` blob 启动，所有字段值无损还原（手工或
      自动测试验证）。
- [ ] 66 个消费者迁移后 `pnpm lint` / `tsc` / `pnpm build` 全绿。
- [ ] `backfillDefaultShortcuts` / `backfillBuiltinExcludePatterns` 行为不变（已有测试通过）。
- [ ] 行为零回归：外观/编辑器偏好/vault/AI 配置/桌宠几何/看板列在 UI 上表现不变。

## Definition of Done

- Tests 拆分并更新（每 store sibling test + 持久化扇出 round-trip）。
- lint / typecheck / build / test 绿。
- 老用户配置兼容性已验证。
- 删除旧 settingsStore（或 shim 标注移除日期）。

## Out of Scope

- 不改字段语义/默认值/持久化键。
- 不拆持久化存储文件（继续 `settings:all` 单文件）。
- 不动其它 god 对象（`editorStore`、`App.tsx` pet 焊接、`aiStore→editorStore` 反向依赖）——后续任务。
- 不优化 pet 拖拽写盘频率（行为不变）。
- 不为 cli-adapter/vault-provider 做任何抽象调整。

## Technical Approach

### 扇出加载器（关键设计）

单文件持久化的核心：保留一个 `settingsPersistence.ts`（或 loader），

1. 启动时 `storageClient.readTextFile('settings:all')` → JSON parse。
2. 按 PERSIST_KEYS 分片：每 store 暴露 `hydrate(blob: Record<string,unknown>)`，
   loader 调各 store 的 `hydrate`，store 只挑自己的键。
3. 写盘：每 store setter 触发 `debouncedPersist`，序列化时**合并所有 store 的
   PERSIST 切片**为单个 blob 写回（一个 writer，行为同今天）。

实现上：每 store 注册自己的 `PERSIST_KEYS` 切片 + 一个共享 `schedulePersist()`
收集所有 store 切片合并写盘。pet 拖拽高频写仍走同一个 debounced writer，行为不变。

### 迁移策略：单次大 PR

66 消费者机械替换，原子提交（避免中间态多 store + 残留 settingsStore 并存）。
替换高度可脚本化：`useSettingsStore((s) => s.X)` → 按字段→store 映射表换 import + hook 名。

### 字段→store 映射表

（见 Decision 节字段归属；implement 阶段生成完整字段映射用作脚本/校验依据。）

## Technical Notes

- `settingsStore.ts:254` PERSIST_KEYS / `debouncedPersist` / `pickPersisted` 是持久化核心。
- `backfillDefaultShortcuts`(`:227`) / `backfillBuiltinExcludePatterns`(`:242`)。
- 全量订阅仅 `SettingsPage.tsx:158,1000`（合理，设置页需要多字段）。
- 140 处 `useSettingsStore.getState()` 一次性读（service/命令处理器，不触发 re-render）。
- `vaultStore.ts:95` 已是跨 store 写（vaultStore→settings），拆后改写 vaultConfigStore。
