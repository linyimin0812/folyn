# Slice 7 首版验收报告（三来源完整流程核查）

日期：2026-10-11。范围：对 prd.md「第一版验收场景」逐条端到端核查既有实现；仅补缺失的行为回归测试，不新增功能。全部为定向 vitest 运行（workspace `--project desktop`），未做全项目构建。

结论：7 个验收场景全部通过，未发现需要修复的场景缺陷。本轮新增 5 个回归测试（来源筛选、手动刷新、目录选择保存、生成中切换知识库、跨来源断尾记录扫描）。此前两次套件级报错（`getFileTypeIcon is not a function` / open-color JSON import attribute）是运行方式错误——在 `apps/desktop` 内直接 `npx vitest` 绕过了根目录 `vitest.workspace.ts` 的别名与 setup，非代码缺陷；从仓库根目录运行即全部通过。

## 场景核查

### 1. 三工具会话浏览 + 按来源/项目筛选 — ✅

- 服务层：`index.test.ts > unions codex, claude and pi sessions, newest first`（三来源合并排序）；各适配器发现测试覆盖跨项目（codex 活动目录 + 归档、claude slug 不可逆、pi 头部 cwd）。
- UI 层：`SessionsPanel.test.tsx > mounting the panel refreshes discovery and lists sessions with project + source`；`the project filter narrows the list`。
- **本轮新增** `the source filter narrows the list to one tool; an unmatched source shows the empty state`——此前只有项目筛选有交互测试，来源筛选缺失。
- 「会话」入口注册：`registerBuiltinPanels.test.ts`（8 项通过）。

### 2. 源工具新增消息后读取最新 — ✅

- 重进列表：`going back returns to the list and refreshes discovery`（discover 第二次调用）。
- 打开会话：`opening a conversation re-reads its detail`（每次 open 都重新 read）。
- **本轮新增** `the manual refresh button re-runs discovery and lists sessions the source tool added meanwhile`——刷新按钮此前无测试。
- 保存时新读取与快照校验：`confirming after the source changed fails with a reselect-required error`。

### 3. 文字片段 / 多消息 / 整会话（当前分支）→ 原文摘录保存到所选目录 — ✅

- `captureService.test.ts`：文字片段（仅收录所选区间，坐标可复现）、多消息（含工具记录）、整分支（共享前缀 + 排除兄弟分支）。
- `SessionsPanel.test.tsx`：三种选择的交互流程 + 保存确认。
- **本轮新增** `choosing a vault subdirectory in the save dialog saves into that directory`——此前测试只确认根目录保存（dir=''），「用户选择目录」路径缺失；现在断言 save 收到 dir='notes'。
- 文件名安全（sanitizeFilename）与写失败（证据先写、笔记后发）均在 captureService 覆盖。

### 4. AI 整理笔记：编辑确认保存，素材仅来自所选 — ✅（含一条已知上限）

- 素材边界（stub 输入检查）：`noteGeneration.test.ts > contains selected message text...`、`a text-range message contributes ONLY the selected excerpt`、`sibling-branch content is absent`、`calls runRigChat with historyMode none...`（隔离请求、无历史）。
- UI 流程：`generates an editable draft; confirming saves the EDITED content plus the evidence bundle`（保存的是用户编辑后的草稿）。
- 显式失败状态（无模型 / 过大 / 图像不支持 / 信息不足 / 失败重试 / 取消）各有测试。
- ⚠️ 已知上限：模型桥接 `runRigChat` 全程以 stub 验证；真实供应商调用、真实流式行为与生成质量不自动化（按任务约束不做付费调用）。流程与素材边界已由 stub 证明。

### 5. 来源说明 + 原文定位 + 副本，源删除后可查 — ✅

- `captureService.test.ts > the note carries provenance, vault-relative evidence link and verbatim content`、`evidence survives source deletion...`（原始 JSONL + 摘要 + 摘要校验）、定位块 `the note ends with a fenced locator block...`。
- `SessionsPanel.test.tsx`（source navigation 组）：缺失活源时打开证据副本（收录时间 + 完整性 + 原文渲染）、重开即重读（无陈旧缓存）、附件经 vault 相对链接在移动/重启后仍可读（`asset links in the note are note-relative` + 字节一致性测试）。

### 6. 缺失附件 / 截断结果 — ✅

- 保存前可见：`SessionsPanel.test.tsx > selecting messages...`（缺失提示条）。
- 保存后保留：`captureService.test.ts > missing material is recorded in note + records and the capture is never "complete"`；选择本身完整时 warnings 仍如实记录但不误标不完整。
- 各适配器断尾记录测试（codex/claude/pi 各一条）+ **本轮新增** `index.test.ts > a torn trailing record in ANY source is skipped with a warning`（跨来源扫描：三种格式各追加半行，断言先前记录完好 + 显式 warning）。

### 7. 分支会话：全选仅当前分支，切换后单独选择 — ✅

- `captureService.test.ts > whole-branch selection on a forked pi session...`（共享前缀包含、兄弟分支排除、定位记录分支）。
- `SessionsPanel.test.tsx > select entire branch selects every message of the CURRENT branch`、`a branched session shows a branch switcher; switching re-reads and clears the selection`（切换清空选择，不静默保留）。
- AI 素材不含其他分支：`noteGeneration.test.ts > sibling-branch content is absent`。

## tickets #7 回归缺口逐项

| 缺口 | 状态 | 证明 |
|---|---|---|
| 未写完的源写入（断尾记录） | ✅ | 各适配器 torn 测试 + 新增跨来源扫描 |
| 不可访问的根（权限拒绝） | ✅ | `index.test.ts` 三条 EACCES 测试：单来源失败为逐来源错误，其余来源仍在列表 |
| 不支持的格式 | ✅ | pi v4 发现期显式错误、parsePiSession v2 抛错（不迁移）；codex/claude 未知记录类型计入 warnings 不崩溃 |
| 缺失附件 | ✅ | 保存前后均显式列出（见场景 6） |
| 保存失败（证据写失败 → 笔记不发布；冲突 → 不静默覆盖） | ✅ | `captureService.test.ts` 两条（conflict / evidence write failure），AI 笔记同样不覆盖 |
| AI 生成中 / 确认前切换知识库 | ✅ | 既有 `switching the vault between generation and confirm...` + **新增** `switching the vault while generation is IN FLIGHT...`（请求进行中切换，确认时绑定写入，仅写一次） |

## 其他已知上限（非缺陷）

- ⚠️ 三来源适配器基于调查时验证的格式（codex rollout、claude JSONL、pi v3），测试用合成 fixture；上游格式演进依赖逐来源错误隔离与显式 unsupported 状态兜底，无法预先穷举。
- ⚠️ Tauri 真实文件系统端到端（真实 `~/.codex` 等路径读取）不在自动化内：`fs.tauri.ts` 是薄适配层，测试经内存 FS 端口注入；真机行为需人工验收。

## 最终测试结果

定向运行（仓库根目录，`npx vitest run --project desktop`）：

- `src/components/sessions/SessionsPanel.test.tsx`：31 通过
- `src/services/externalSessions/*`（8 个文件）：107 通过
- `src/services/registerBuiltinPanels.test.ts` + `src/i18n/extracted-namespaces.test.ts`：25 通过

合计 163 项通过，0 失败。本轮无产品代码改动（仅新增测试），无 i18n 字符串变更。

## 终检补充（check round，2026-10-11）

终检（slice 6 + 7 复查 + 全特性轻扫）发现并修复 1 处产品缺陷、补 4 个回归测试：

- **缺陷（已修复）**：定位打开时记录的分支已消失（读取抛错）→ 回退默认分支投影，但若所选消息 id 恰好仍可解析，则无任何提示，面板静默显示非收录分支。新增 `branchChanged` 状态 + `nav.branchChanged` 提示（6 语言），`SessionsPanel.tsx`。
- 补测：多区间定位解析（token 内逗号 + 分隔逗号，sourceLocator）；剪贴板读取失败路径；分支消失回退 + 提示；证据视图区间节选渲染（坐标 + 无 rawRecords）。

定向复跑：167 项通过，0 失败（SessionsPanel 34、sourceLocator 7，其余不变）。
