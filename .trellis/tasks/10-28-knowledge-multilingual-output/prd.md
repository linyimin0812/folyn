# 知识库多语言：生成内容 + 界面文案

## Goal

知识库当前 prompt 硬编码中文输出（`kbPrompts.ts:99`「用中文回答」等），界面文案全部中文硬编码。两项多语言化：生成内容语言可控；知识面板 UI 接入既有 i18n 体系。

## Requirements

### A. 生成内容多语言

* 主题（theme）级语言偏好：manifest 新增 `language` 字段（`'auto' | 'zh' | 'en' | ...`），默认 `auto`。
* `auto`：prompt 指示模型以「资料原文语言」输出（不加语言检测代码——模型自判）。
* 指定语言：prompt 指示以该语言输出。
* 覆盖所有输出口：主题合成（结论/正文）、检索问答（kbAsk）、引用核验（kbVerify 的 verifyNote）——凡是产出用户可见文本的 prompt。
* UI：主题设置（ThemeDialog）加语言选择；现有主题缺省 auto。
* 结构化 JSON 字段名、校验逻辑不随语言变（只有值文本跟随）。

### B. 界面 i18n

* 按 `.trellis/spec/desktop/frontend/i18n-guidelines.md` 接入：新增 `knowledge` namespace（`src/i18n/locales/*/knowledge.json`），知识面板全部用户可见文案（KnowledgePanel/Workbench/Setup/Sources/Ask/Reviews/TopicReader/ThemeDialog/ScopePicker + store 内 notice 文案）改 `t()`。
* 跟随应用 locale（localeStore），不单独设知识面板语言；内容语言（A）与界面语言（B）相互独立。
* 缺 key 不阻断（i18next returnNull:false 契约）。

## Acceptance Criteria

* [ ] 主题设为 auto + 英文资料 → 知识页/问答输出英文；设为 zh → 输出中文（prompt 层测试断言语言指令注入）。
* [ ] locale 切 en → 知识面板文案英文（zh/en 两个 locale 文件齐备，无硬编码中文残留——可 grep 校验）。
* [ ] 既有 knowledge 测试适配后全绿；新增 prompt 语言注入用例。

## Out of Scope

* 整个应用其余面板的 i18n 补齐（只管知识面板）。
* 已生成知识页的翻译/批量改语言。
* 语言自动检测（模型自判即止）。

## Technical Notes

* 先例：`src/i18n/index.ts`（NAMESPACES 注册）、任意已接入组件的 `useTranslation` 用法。
* 相关文件：`kbPrompts.ts`、`kbLlm.ts`、`kbAsk.ts`、`kbVerify.ts`、`topicSynth.ts`（prompt 组装点）、`kbTypes.ts`/`kbThemes.ts`（manifest 字段）、`ThemeDialog.tsx`、knowledge 各组件与 store 文案。
* 顺序依赖：与本仓库「构建提速」任务改动文件有交集（topicSynth/knowledgeStore），**在该任务完成并提交后开工**。
