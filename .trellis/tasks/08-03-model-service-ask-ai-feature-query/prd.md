# 模型服务页 · 问 AI 查询模型功能

## Goal

在模型服务页面，给每个已添加的模型行加一个"问AI"按钮：点击后调用 AI，根据模型 id（+ provider 信息）判断该模型支持哪些能力，自动填充/校正该模型的 capability 列表。

## What I already know (from repo inspection)

- 模型行渲染：`apps/desktop/src/components/settings/model-services/ProviderDetailSection.tsx:316-349`。每行目前只有一个 **remove** 减号按钮（335-347），没有"编辑能力"按钮。`CapabilityPills` 是只读展示，不可点击编辑。
- 6 类能力的现状：
  - `Capability` union 只有 **5** 个成员：`vision | reasoning | web-search | function-call | structured-output`（`apps/desktop/src/services/modelRegistry/types.ts:9-14`）。
  - 用户列的 6 类映射：推理=reasoning✓、工具=function-call✓、视觉=vision✓、联网=web-search✓、**嵌入=embedding ✗（类型不存在）**、**重排=rerank ✗（类型不存在）**。
  - 用户列表里**没有** structured-output（类型里有但用户没列）。
  - `CAPABILITY_PILL` 只渲染了 4 类（vision/reasoning/web-search/function-call），structured-output 注释说明"intentionally skipped"（`capabilityIcons.tsx:7-9`）。
  - embedding/rerank 模型在 `models-catalog.json` 里以 id 字符串形式存在（如 line 257, 3174），但从未作为聊天模型出现在此页能力列表里。
- `Model.capabilities` 字段来源：`ownerMap`（`useModelRegistryStore`），无任何 setter / 写路径。要写回需要新增 store action。
- 既有"AI 查询补元数据"模板：`apps/desktop/src/services/planMyDayService.ts:304-336`。形态：`createAdapter(aiConfig.cliAdapter)` → `adapter.start(...)` → `collectTextFromStream(...)` → `adapter.send(prompt)` → `extractJsonObject(text)` → `JSON.parse` → apply or throw friendly error。同类还有 clipService / wikiQueryService / githubAnalysisService。
- i18n：react-i18next，`settings:` 命名空间，zh/en 各一份（`apps/desktop/src/i18n/locales/{zh,en}/settings.json`）。
- AI 调用入口：`@mochi/cli-adapter` 的 `createAdapter`，使用 `aiConfig.cliAdapter` + `aiConfig.cliPath`。

## Assumptions (to validate)

- 用户希望保留"已添加模型"现有行的布局，按钮放在 remove 按钮旁（同一行 tail）。
- AI 返回结构化 JSON（6 个布尔），用 `extractJsonObject` 复用既有路径。
- 写回路径：扩展 store，加一个 `setModelCapabilities(providerId, modelId, capabilities)` action，覆盖该 model 的 `capabilities`（不影响 catalog，只在 ownerMap / 用户 override 层）。

## Open Questions (Blocking / Preference only)

(全部已解决)

## Decisions (ADR-lite)

- **Q1 → A**：扩展 `Capability` union 至 6 类，新增 `embedding`、`rerank`，并补 `CAPABILITY_PILL` 图标。理由：用户明确列了 6 类，结构上保持 1:1 映射最干净。embedding/rerank 在聊天模型行上几乎恒为 false 是可接受的（pills 已有 length===0 的 null 兜底）。
- **Q2 → A**：直接覆盖 + toast 撤销。最懒、最快反馈，撤销机制保留原 capabilities 引用即可。
- **Q3 → B**：问AI + 手动编辑按钮并存。用户既要 AI 自动填充，也要在 AI 不准时手工校正。
- **Q4 → 复用 aiConfig**：调用入口镜像 `planMyDayService.ts`，使用 `useAiConfigStore.getState()` 拿 `cliAdapter` + `cliPath`，不引入新 AI 配置面。

## Requirements

- 扩展 `Capability` union 到 7 类：`vision | reasoning | web-search | function-call | structured-output | embedding | rerank`。补 `CAPABILITY_PILL` 里 embedding / rerank 的图标 + 颜色（lucide-react 选合适图标，如 `Boxes`/`Layers`）。
- store 新增写回路径：`useModelRegistryStore` 加一个 action `setModelCapabilities(providerId, modelId, capabilities)`，覆盖 ownerMap 中该模型的 capabilities（不动 catalog / models-catalog.json）。
- 模型行尾新增两个按钮：
  - **问AI**（sparkles 图标 + tooltip "问AI查询能力"）：点击 → loading 态禁用按钮 → 调 `askModelCapabilities(model, providerEntry)` → 返回 6 项布尔 JSON → 直接写回 capabilities + toast "已更新能力 / [撤销]"（撤销 = 用闭包里的旧 capabilities 回写一次）。
  - **编辑**（pencil 图标 + tooltip "编辑能力"）：点击 → 打开 `CapabilityEditModal`：6 项 toggle（带原值高亮），保存即写回，取消关闭。
- AI 调用服务文件：`apps/desktop/src/services/askModelCapabilitiesService.ts`，镜像 `planMyDayService.ts:304-336` 的形态（createAdapter + collectTextFromStream + extractJsonObject + JSON.parse），prompt 要求模型严格返回 `{"reasoning":bool,"function-call":bool,"vision":bool,"web-search":bool,"embedding":bool,"rerank":bool}`。
- i18n：新增 keys 到 `apps/desktop/src/i18n/locales/{zh,en}/settings.json` 下 `settings:models.askAI.*`、`settings:models.editCapabilities.*`。

## Acceptance Criteria

- [ ] `Capability` union 含 7 类成员；`CAPABILITY_PILL` 对 6 类（除 structured-output 仍按现状跳过外）都有图标映射。
- [ ] 模型行尾出现"问AI"和"编辑"两个按钮，图标清晰，hover tooltip 双语齐全。
- [ ] 点"问AI"：按钮进入 loading 态（旋转/spinner），期间禁用；成功后 pills 立即更新；失败 toast 报错，原值不变。
- [ ] 点"编辑"：弹出 `CapabilityEditModal`，6 项 toggle 显示当前值；改后保存即写回；取消不写。
- [ ] "问AI"成功后的 toast 有"撤销"按钮，点撤销回退到原 capabilities。
- [ ] 同一行连续点"问AI"二次，每次都走完整 loading→apply 流程，不卡死。
- [ ] 切换 provider 后，按钮仍正常工作（不引用旧 provider 上下文）。
- [ ] lint / typecheck / build 通过。

## Definition of Done

- lint / typecheck / build 通过。
- 不破坏 catalog 数据；写回只在用户 override 层。
- 双语 i18n 齐全。

## Out of Scope (explicit)

- 批量"问AI"（一次给整个 provider 的所有模型）—— MVP 不做。
- 把 embedding / rerank 模型显示到聊天模型列表里（仍按现有 catalog 区分）。
- 问AI 的结果持久化到 catalog / `models-catalog.json`（只在 ownerMap 用户 override 层）。
- 自定义 prompt 配置（prompt 硬编码在 service 里）。

## Technical Notes

- 既有 AI 调用模板直接复用：`planMyDayService.ts:304-336`、`extractJsonObject`（`apps/desktop/src/services/aiStreamUtils.ts:19-22`）。
- Modal 复用 `.sw-modal` 样式 + `role="dialog"` 模式（参考 `apps/desktop/src/components/schedule/ScheduleModal.tsx:157`）。
- store 写回路径需要新增：`useModelRegistryStore` 当前只有只读/删除 action；新增 `setModelCapabilities(providerId, modelId, capabilities: Capability[])`。
- prompt 设计：传 model id + provider 名（中英皆可），要求 AI 返回严格 JSON `{"reasoning":bool,"function-call":bool,"vision":bool,"web-search":bool,"embedding":bool,"rerank":bool}`，不要解释。
- `structured-output` 不在问AI的查询范围（用户列表里没有），保留在 union 但 pills 渲染时跳过（现状不变）。

## Implementation Plan (small PRs / phases)

- **Phase 1 — 类型 + store 写回路径**：扩展 `Capability` union、`CAPABILITY_PILL` 加 embedding/rerank 图标、`useModelRegistryStore` 加 `setModelCapabilities`。纯类型/store 改动，无 UI。先跑通 typecheck。
- **Phase 2 — 问AI 服务 + 行按钮**：新增 `askModelCapabilitiesService.ts`；`ProviderDetailSection` 行尾加"问AI"按钮 + loading 态 + toast 撤销；连通写回。
- **Phase 3 — 手动编辑 Modal**：新增 `CapabilityEditModal.tsx`；行尾加"编辑"按钮 → 打开 modal → 6 项 toggle → 保存写回。
- **Phase 4 — i18n + 自测**：补双语 keys；手测每个 AC；lint/typecheck/build。
