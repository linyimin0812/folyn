# 知识页支持页内编辑（不跳转编辑器）

## 背景

`TopicReader` 的「编辑知识页」按钮当前调用 `openInEditor(topic.path)`：在编辑器打开文件并切回 files 面板。用户希望在知识页当前页面直接编辑并保存，不离开知识工作区。

## 需求

- 点击「编辑知识页」→ 当前页面切换为编辑态（textarea 编辑该页原始 Markdown 全文，含 frontmatter 与脚注定义，与磁盘文件一致），不跳转编辑器、不切面板。
- 保存：原子写回主题页文件（`kbWriteAtomic` + `suppressWatcherFor`），随后 hydrate 刷新（dataVersion+1 → 阅读视图重读正文与引用）。
- 这是**用户编辑**：不更新 manifest `lastProgramHash`（保持 ADR-0006 语义 —— 用户编辑过的页，AI 追加内容降级进审阅）；写入后失效 kb 检索索引缓存。
- 取消：丢弃草稿回到阅读态。
- 保存失败（文件缺失、写失败）如实提示，停留编辑态。

## 非目标

- 不做富文本/markdown 所见即所得编辑，textarea 原文编辑即可（与审阅「编辑后采用」同交互层级）。
- 不改 CitationPanel 的「打开原文/历史版本」（仍跳编辑器）。

## 实现

- `knowledgeStore` 新增 `saveTopicPage(tpId, content)` action：capture → beginMutation → 读 manifest 取 path → suppress watcher → kbWriteAtomic → invalidateKbIndexCache → hydrate → endMutation。返回 `{ok}|{ok:false,error}` 供 UI 提示。
- `TopicReader.SelectedTopic` 增加 `editing` 状态：编辑态渲染 textarea（复用 ReviewsView 的 textarea 样式）+ 保存/取消按钮；保存成功后由 remount key（含 dataVersion）自然重读。
- 编辑期间选择变化/重挂载即丢弃草稿（不做草稿持久化）。

## 验收

- 点「编辑知识页」→ 页内出现 textarea，含文件原文；改正文保存 → 阅读态显示新内容，引用脚注仍可用。
- 保存后该页 hash ≠ lastProgramHash → 后续 AI 追加进审阅（user-edited 语义保持）。
- 取消 → 回阅读态，文件未写。
- 单测：`TopicReader.test.tsx` 增编辑态用例（进入编辑、保存触发 store action、取消不写）。
