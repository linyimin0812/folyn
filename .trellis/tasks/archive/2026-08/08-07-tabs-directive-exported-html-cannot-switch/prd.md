# Tabs directive exported HTML cannot switch

## Goal

`::::tabs` 容器在 app 内预览可以点击切换；但导出 HTML 后点击 tab 标签无反应。需要让导出的静态 HTML 也能切换 tab。

## What I already know

* `TabsPlugin.tsx:18-90`：`TabsComponent` 用 React `<button onClick={() => setActiveTab(i)}>` 渲染 tab 标签，`useEffect` 收集 `[data-is-tab="true"]` 面板并设置初始 display（tab 0 `block`，其余 `none`）。
* 导出管线 `renderMarkdownToHtmlViaDom` (`exportService.ts:173`) 在隐藏 DOM 挂载 `MarkdownPreview`，等 async 稳定后取 `container.innerHTML`（`exportService.ts:270`）。React 合成事件依赖 root 上的事件代理，`innerHTML` 抽取后事件丢失 → 静态 HTML 里按钮点不动。
* `applyContainerEnhancers` (`exportService.ts:374`) 对每个 `[data-container]` 块查 `getEnhancer(name)`；tabs 没注册 enhancer → `if (!enhancer) return` 早退，**按钮没被剥**（FilePreviewPlugin 的 action button 才被剥——那走 enhancer 路径）。
* 初始 display 由 React 在挂载时已设置好（导出 DOM 中 tab 0 可见，其余 hidden），所以"显示哪个 tab"对，只是不能切。
* `exportActiveHtml` (`useExport.ts:143`) 拼 `<!DOCTYPE html>` 模板，`<head>` 里只有 `<style>`，没有 `<script>` 注入位。
* TabsComponent 按钮目前没专门标识；选择器 `[data-container="tabs"] button` 太宽——会把嵌在 tabs 内的 file-preview action button 也误匹配（虽然 file-preview 走 enhancer 被剥了，但 tabs 内嵌套其他含 button 的容器时仍可能误伤）。

## Assumptions (temporary)

* 用户想要的是"点击 tab 切换显示对应面板"，跟 app 内行为一致。
* 导出 HTML 默认走 light theme；DARK_THEME_VARS 也注入。tab 按钮 inline style 用 `var(--acc, #068ad5)` 等 CSS 变量，脚本里也用同名变量，主题切换自动跟随。
* 同一文档可能有多个 `::::tabs` 块——脚本需用事件代理一次覆盖全部。

## Open Questions

* （已解决）选 A：在 `exportActiveHtml` 的 `<head>` 注入全局事件代理 `<script>`，按钮加 `data-tab-button` 属性。

## Requirements (evolving)

* 导出 HTML 中点击 tab 标签能切换显示对应面板，行为与 app 内一致。
* 多个 `::::tabs` 块在同一文档中各自独立切换。
* 不影响 app 内预览（脚本只在导出 HTML 里注入）。
* 不破坏现有的导出 HTML 结构（`<head>` 仅多一段 `<script>`）。

## Acceptance Criteria (evolving)

* [ ] 导出 HTML 后用浏览器打开，点击不同 tab 标签能切换面板显示。
* [ ] 多个 `::::tabs` 块独立工作。
* [ ] tabs 内嵌套 `:::file-preview` 等含 button 的容器时，file-preview 的 button 不会被误触发 tab 切换。
* [ ] app 内预览行为不变（不引入额外 script 标签）。
* [ ] `pnpm lint` / typecheck / 既有测试绿。

## Definition of Done

* Tests added（导出 HTML 包含 script + 按钮 data-tab-button 属性的单测；或 applyContainerEnhancers 路径的单测）。
* Lint / typecheck / build green.
* 不改动 TabsComponent 的视觉行为，只加 `data-tab-button` 标识。

## Out of Scope

* 其他交互式 container 插件（如 callout）的导出修复——单独任务。
* CSS-only tabs（radio + label）重构——改动太大。
* PDF 导出（如存在）的 tabs 处理——PDF 通常不需要交互，留作后续。

## Technical Notes

* 入口：`apps/desktop/src/hooks/useExport.ts:154-165`（HTML 模板拼装）。
* 备选入口：`apps/desktop/src/services/exportService.ts:374`（`applyContainerEnhancers`）。
* TabsComponent：`packages/container-plugins/src/plugins/TabsPlugin.tsx:62-82`（按钮渲染）。
* 选择器策略：给 tab 按钮加 `data-tab-button` 属性（TabsComponent 改 1 行），脚本用 `[data-tab-button]` 选择——避免误匹配嵌套容器里的其他 button。
* 初始状态：React `useEffect`（`TabsPlugin.tsx:34-37`）已在导出 DOM 挂载时设好 tab 0 可见，脚本只需响应点击切换。

## Decision (ADR-lite)

**Context**: React 合成事件在 `innerHTML` 抽取后丢失；其他方案（per-block script、CSS-only tabs）改动面更大或重复注入。

**Decision**: 选 A——`exportActiveHtml` 的 `<head>` 注入一段全局事件代理 `<script>`，按钮加 `data-tab-button` 属性以精确选择。脚本走 `var(--acc, #068ad5)` 等 CSS 变量保持主题跟随。

**Consequences**:
- 一处脚本覆盖文档内所有 tabs 块，最小 diff。
- TabsComponent 多一个无副作用的 `data-tab-button` 属性（in-app 预览无影响）。
- 不解决嵌套 tabs 内 file-preview 的 action button 问题——但 file-preview 已被 enhancer 剥掉 button，不会误触发。
- 其他交互式 container（如未来 callout/accordion）需要类似处理时，复用此 head 注入位。

## Implementation Plan

* PR1（单步）：
  1. `packages/container-plugins/src/plugins/TabsPlugin.tsx`：给 button 加 `data-tab-button` 属性。
  2. `apps/desktop/src/hooks/useExport.ts`：在 `HTML_STYLES` 旁加一个 `TABS_INTERACT_SCRIPT` 常量（事件代理脚本），拼到 `<head>` 的 `<style>` 后。
  3. 跑 lint / typecheck / test。
