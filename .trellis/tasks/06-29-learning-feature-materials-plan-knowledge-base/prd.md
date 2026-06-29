# 学习功能：学习资料 + 计划 + 个人知识库

## Goal

用户输入一个学习主题（如 "agent 开发"），Quill 帮他完成完整的学习闭环：
1. **找学习资料** —— 检索网络资料 + 经典书籍/论文
2. **做学习计划** —— 把主题拆成有序的学习单元，落到可追踪的任务/日程
3. **建设个人知识库** —— 把学习过程中的笔记、要点、资料沉淀为 vault 里的结构化文档

让 Quill 从"编辑器"升级为"学习工作站"，复用已有的 AI 助手 / Vault / Schedule 能力。

## What I already know

来自用户消息：
* 学习闭环 = 找资料 → 经典书籍 → 学习计划 → 个人知识库
* 触发方式：输入学习主题
* 示例主题：agent 开发

来自代码库调研：
* Quill = Tauri 2 + React 18 + CodeMirror 6 的本地优先 Markdown 编辑器，pnpm monorepo
* **AI 助手**（`apps/desktop/src/components/ai/`）已有：`AiPanel`、`aiStore`、`cli-adapter`（Claude 适配器）、`DeepResearchDialog`（深度研究）、`IngestDialog`（资料摄取）、`WikiToolbar` / `WikiActivityLog`（已有 wiki 概念雏形）
* **Vault 系统**（`apps/desktop/src/store/vaultStore.ts` + `packages/vault-provider/`）：本地优先文档管理，多后端（local/github/webdav/s3）。天然承载"个人知识库"
* **Schedule 工作台**（`apps/desktop/src/schedule/` + `components/schedule/`）：daily note 里 `## 日程`（`- @event`）和 `## 任务`（`- [ ] @{col:.. cat:.. prio:.. due:..}`）格式，markdown 驱动。天然承载"学习计划"
* **容器插件**（`packages/container-plugins/`）：`:::callout` 等指令，可用于学习笔记的富结构
* 编辑器已有 slash commands、GFM、remark directives、实时预览

## Assumptions (temporary)

* "找资料"复用 AI 助手的 CLI 调用能力（类似 DeepResearchDialog 的网络检索），而非引入新的搜索 API
* "学习计划"以 markdown 形式落盘到 vault（与 schedule 同一套 daily note / 任务格式或单独的学习计划文档）
* "个人知识库"= vault 里一组结构化 markdown 文档（按主题组织），不是新的存储引擎
* 资料来源的"经典书籍"主要靠 AI 检索推荐书目元信息（书名/作者/简介），不做版权全文获取

## Open Questions

* （收敛中）MVP 边界与失败/边界处理 — 见下方 Expansion Sweep

## Decision (ADR-lite)

**Context**: 学习功能需要编排"找资料→计划→知识库"三步闭环，需确定功能形态。
**Decision**: 采用 Approach B —— 新增顶级"学习"工作台视图（对标 schedule workbench）。主题看板 + 资料清单 + 计划时间线 + 知识库入口，常驻可追踪。
**Consequences**: 前端工作量较大（新建视图/组件/store），但学习闭环可视化、进度常驻。需复用 AI/Vault/Schedule 现有能力以控制增量。后续问题需收敛 MVP 范围避免过度膨胀。

**Decision 2（持久化）**: 采用 Option 1 —— 每个学习主题 = vault 里一个 markdown 文档（`学习/<主题>.md`），用 front-matter + 约定段落（`## 资料` / `## 计划` / `## 笔记`）承载结构化数据。工作台是该类文档的可视化视图。数据即文档、可手编、跨后端同步，与 schedule 的 markdown 驱动一脉相承。

**Decision 3（主题范围）**: 多主题管理。工作台左侧主题列表，可同时存在多个学习主题，点选切换当前聚焦；支持新建/归档/删除。

**Decision 4a（找资料）**: 复用 AI 助手 CLI 调用（`cli-adapter` Claude 适配器），新增"学习研究"指令。AI 输出结构化资料清单（网络资料 + 推荐书目：书名/作者/简介/难度/链接），写入主题文档 `## 资料` 段。不引入新搜索 API。

**Decision 4b（学习计划）**: 自定义"学习单元"格式（不复用 schedule 任务行）。主题文档 `## 计划` 段，行格式形如 `- [ ] 1. 单元名 @{est:2h dep:- prog:0}`，承载顺序/估时/依赖/进度。进度勾选写回 markdown。

**Decision 4c（知识库/笔记）**: 主题文档 `## 笔记` 段承载要点摘录；深笔记另起 vault 子文档（`学习/<主题>/`），用 wiki 链接 `[[]]` 挂接。工作台"知识库"区列出挂接子文档，点击在编辑器打开。

**Decision 5（与 schedule 关联 · MVP）**: 单向"排到日程"+回链。学习单元"排到日程"按钮 → 写入目标 daily note `## 任务` 段一行 `- [ ] 单元名 @{col:todo cat:learn study:<slug> unit:<n> due:.. prog:0}`（扩 `TaskCategory` 枚举加 `learn`）。学习工作台扫描各 daily note 带 `study:<slug>` 的任务，显示单元"已排期/已完成"状态；schedule 勾选完成 → study 单向读回反映到单元进度。不双向写。

**Decision 6（高效学习法融入 · MVP）**: 融入证据支持的学习法，全部 markdown 驱动 + 复用现有组件，详见 `research/learning-methods.md`：
- **间隔重复(SM-2)**：主题文档新增 `## 复习` 段，行格式 `- [ ] 原子摘要 @{next:YYYY-MM-DD rep:N ef:F.F ivl:N lapses:N topic:<slug> src:[[..]]}`；扫描器抄 `schedule/markdown.ts` 段落写回；4 按钮(Again/Hard/Good/Easy)→q 值→SM-2 更新 `next/rep/ef/ivl`；lapse 不降 ef（避 ease hell）。
- **主动检索**：AI"生成自测题"动作，先只给题、答案折叠。
- **费曼学习法**：AI"费曼挑战"动作（扮演 5 岁小孩追问），暴露盲区写入 `:::callout{type="warning" title="盲区"}`。
- **SQ3R**：AI"预读"动作，给 `## 资料` 条目生成大纲+预读问题写入 `:::callout{type="info" title="预读问题"}`。
- **交替练习**：跨所有主题的"今日复习"队列（扫描 `学习/*.md` 的 `## 复习` 到期原子，带 `topic:<slug>` 标注来源）。
- **Zettelkasten**：深笔记原子化放 `学习/<主题>/<slug>.md`，从 `## 笔记` 用 `[[]]` 挂接（复用 wiki/graph）。
- **精细加工**：`## 笔记` 要点模板 `- **概念**: … | 因为: … | 例子: … | 类比: [[..]]` + AI"追问 elaboration"。
- **番茄工作法**：工作台头部复用 `Pomodoro.tsx`。
- **Desirable Difficulties**：作为设计原则（偏好主动检索/费曼/交错复习，不做"重读资料"按钮），不产代码。
- 三个 AI 动作统一走"打开 AI 面板 + 预填带上下文提示词"模式（`ContextMenu.tsx:139-140` 的 `addFileToChat` + `showAiPanel`），无新调用链。

## Requirements (evolving)

* 输入学习主题
* 自动检索学习资料 + 经典书籍/论文推荐
* 生成结构化学习计划（有序学习单元，可追踪进度）
* 生成/沉淀个人知识库文档到 vault
* 与 schedule 关联：单元可排到日程，回链读回排期/完成状态
* 高效学习法融入：SM-2 间隔复习段 + 跨主题今日复习队列 + AI 费曼/自测/SQ3R 三动作 + Zettelkasten 原子笔记 + 精细加工模板 + 复用 Pomodoro

## Research References

* [`research/learning-methods.md`](research/learning-methods.md) — 9 种学习法→工具参考→Quill markdown 嵌入→MVP-fit 评级表 + 可实现 SM-2 规格 + 段落写回/复用点(file:line)

## Acceptance Criteria (evolving)

* [ ] 输入 "agent 开发" 能新建主题文档并跑 AI 研究产出资料清单（含可访问链接 + 推荐书目）
* [ ] 能生成带顺序/估时/进度的学习计划，勾选单元可写回 markdown
* [ ] 笔记段 + 子文档 wiki 链接可在工作台列出并在编辑器打开
* [ ] 学习单元可"排到日程"，生成的 daily note 任务行带 `cat:learn study:<slug> unit:<n>` 回链
* [ ] schedule 勾选该任务后，学习工作台对应单元显示已完成（单向读回）
* [ ] 主题文档 `## 复习` 段：AI/手动添加复习原子，4 按钮(Again/Hard/Good/Easy)按 SM-2 更新 `next/rep/ef/ivl` 写回 markdown
* [ ] "今日复习"队列聚合跨所有主题的到期原子（带来源主题标注）
* [ ] 3 个 AI 动作（费曼挑战/生成自测题/SQ3R 预读）能打开 AI 面板带学习上下文，产出可写入对应段/callout
* [ ] 工作台头部可启动 Pomodoro；`## 笔记` 提供精细加工模板
* [ ] 编辑器手改主题文档后，工作台重新解析正确、非托管行原样保留
* [ ] 未配置 AI 适配器时 AI 动作被禁用并提示，复习/计划/笔记非 AI 部分仍可用
* [ ] 全程数据本地优先（vault markdown，跨后端同步可用）

## Definition of Done (team quality bar)

* 测试新增/更新（unit/integration，参照 schedule/vault 的测试风格）
* lint / typecheck / CI green
* 行为变更更新文档/notes
* 风险项考虑回滚

## Out of Scope (explicit)

* 主题归档/恢复
* study↔schedule 双向状态同步（MVP 仅单向读回）
* 资料已读/评分/收藏
* 学习进度统计图表
* 多语言资料去重
* SM-2 高阶特性（同日 learning steps、fuzz、max-interval、lapse 降 ef）——二期

## Technical Approach

* 新增 `apps/desktop/src/study/`：解析/序列化/类型，对标 `schedule/` 的"段落托管 + 原样保留非托管行"模式
* 新增 `apps/desktop/src/components/study/`：工作台视图组件
* 新增 `apps/desktop/src/store/studyStore.ts`：Zustand store
* AI 研究复用 `cli-adapter` + `aiStore` 调用链（参照 DeepResearchDialog）
* 文档读写复用 `vaultStore`
* schedule 关联：扩 `TaskCategory` 枚举加 `learn`；复用 `schedule/markdown.ts` 写任务行；study 侧扫描 daily note 回链

## Implementation Plan (small PRs)

* PR1：study markdown 解析/序列化 + 类型 + 单测（含 `## 资料`/`## 计划`/`## 笔记`/`## 复习` 四段 + `@{...}` 属性，对标 schedule/markdown.ts 段落写回）
* PR2：studyStore + vault 文档读写集成 + 主题列表/切换/新建/删除 UI + 复用 Pomodoro 置入头部
* PR3：工作台主视图（资料/计划/笔记/复习四区）+ 计划勾选写回 + 笔记精细加工模板 + 子文档 wiki 链接 + `## 复习` SM-2 扫描器(4 按钮评级写回) + 跨主题"今日复习"队列
* PR4：与 schedule 关联（扩 cat:learn + 排到日程 + 回链读回）+ AI 接入（学习研究/费曼挑战/生成自测题/SQ3R 预读 四动作，走 addFileToChat 模式）+ callout 盲区/问题块 + 容错降级（AI 不可用禁用 AI 动作）

## SM-2 scheduler spec (minimal)

* 状态属性：`next`(YYYY-MM-DD 到期日) / `rep`(连续正确) / `ef`(ease≥1.3) / `ivl`(上次间隔) / `lapses`
* 评级→q：Again=0, Hard=3, Good=4, Easy=5
* 更新：q<3 → rep=0,ivl=1,lapses+1（不降 ef）；q≥3 → rep 0→ivl=1, 1→ivl=6, ≥2→ivl=round(ivl*ef)，rep+1，ef←ef+(0.1-(5-q)*(0.08+(5-q)*0.02)) 下限 1.3；next←today+ivl
* 到期判定：`next <= today`
* 详见 `research/learning-methods.md` §3

## Technical Notes

* 集成点：AI 助手（资料检索）、Vault（知识库）、Schedule（计划）
* 现有 markdown 驱动约定：daily note `## 日程`/`## 任务`，`- @event` / `- [ ] @{...}`
* spec 索引：`.trellis/spec/{api,cli-adapter,container-plugins,desktop,guides,vault-provider}`
