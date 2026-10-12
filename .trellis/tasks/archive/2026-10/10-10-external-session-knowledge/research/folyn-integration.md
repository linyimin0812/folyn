# Folyn 接入能力调查

调查日期：2026-10-10。以下事实来自当前工作区源码；实现建议尚未实施。

## 可复用能力

- 独立入口：`registerBuiltinPanels` 当前实际只注册 `files`，通过 `featurePanelStore` 注册面板并同步 `editorStore.activePanel`。部分注释仍提及 wiki/calendar，不能据此判断当前注册状态。来源：[registerBuiltinPanels.tsx](../../../../apps/desktop/src/services/registerBuiltinPanels.tsx)。
- 消息阅读和选择：`ChatMessageList` 已有 Markdown、工具详情、附件及多消息选择的接口；未见消息内文字范围选择接口。来源：[ChatMessageList.tsx](../../../../apps/desktop/src/components/chat/ChatMessageList.tsx)。
- 保存位置：`SaveMessageDialog` 接受知识库文件树、文件名和目录选择，调用方负责实际写入；还提供外部保存入口，本需求只要求知识库保存。来源：[SaveMessageDialog.tsx](../../../../apps/desktop/src/components/ai/SaveMessageDialog.tsx)。
- AI 整理：`runRigChat` 支持自定义 preamble、图片及 `historyMode: none`，可用于隔离整理请求，避免历史聊天混入所选素材。来源：[rigChat.ts](../../../../apps/desktop/src/services/rigChat.ts)。
- 现有 CLI adapter 面向启动和流式事件，支持会话恢复参数；这些接口不能替代历史记录发现、读取及无损存档。来源：[types.ts](../../../../packages/cli-adapter/src/types.ts)、[codexAdapter.ts](../../../../packages/cli-adapter/src/codexAdapter.ts)、[claudeAdapter.ts](../../../../packages/cli-adapter/src/claudeAdapter.ts)、[piAdapter.ts](../../../../packages/cli-adapter/src/piAdapter.ts)。
- 现有 Folyn chat 历史保存角色、正文和图片，不覆盖完整外部工具调用与源记录。来源：[session_store.rs](../../../../apps/desktop/src-tauri/src/chat/session_store.rs)。

## 实现建议

1. 新建只读外部会话模块，按来源发现并解析记录，暴露列表、读取及定位能力；不复用执行 CLI 的职责来读取历史。
2. 归一化阅读模型与原始记录分离：阅读模型复用消息组件，原始记录保留完整所选依据；不能仅用 `CliMessage` 作为无损存档格式。
3. 内容选择使用源记录标识和文字范围；AI 请求、摘录与原文副本必须共享同一份选择快照，避免刷新后素材不一致。
4. Markdown 正文关联收录时的原文和附件副本；保存成功应意味着正文与相关素材均已落盘。附件无法取得时明确提示，不声称已完整保存。
5. AI 整理使用独立请求，不注入未选择的会话历史；对上下文不足和素材超出模型容量明确反馈，不能静默补入或截断。

## 仍需验证

来源格式调查完成后明确分支、工具结果归属、附件和定位规则。进入实现前还需阅读相应 frontend/backend/vault-provider 规范，补齐任务上下文。未运行构建或编译，未修改产品代码。
