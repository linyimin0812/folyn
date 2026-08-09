# Plugin Render Error Isolation — Prevent Main App White Screen

## Goal

插件渲染期任意 throw 不应白屏主应用。当前 sidebar / sandbox iframe / tool window / activate 期均已隔离;唯一缺口是 Markdown 预览里的 `:::name` 容器指令 —— trusted plugin 的容器组件在 `MarkdownPreview` 渲染树里 throw 会冒泡到主 React 根。补一个 error boundary 把它兜住。

## What I already know

- Tauri 应用,插件分 trusted / sandbox 两 tier。
- 已有隔离:
  - sandbox iframe / tool window:进程级隔离,RPC 错误收敛在 `dispatchPluginRpc` 的 try/catch(`rpcBridge.ts:418-437`、`toolWindowRpcListener.ts:79-100`)。
  - sidebar feature panel:`PanelErrorBoundary` 包裹(`Sidebar.tsx:40-65`)。
  - activate 期 throw:`App.tsx:269/275/305` 的 `.catch` 兜住。
- 缺口:`MarkdownPreview.tsx:71-87` 的 `DirectiveWrapper` 直接 `createElement(PluginComponent, containerProps)`,无 error boundary。
- `ContainerRenderer.tsx` 无任何 import,死代码,跳过。

## Assumptions (temporary)

- 复用现成 `PanelErrorBoundary`(class component,已有 `getDerivedStateFromError` + `componentDidCatch`)即可,无需新写 boundary class。
- fallback 文案"面板加载失败"在 markdown 容器场景可接受(会带 plugin name + error.message)。

## Decision (ADR-lite)

**Context**: Markdown 预览里插件容器组件 throw 会白屏主应用,需最小隔离。
**Decision**: 复用 `PanelErrorBoundary` 包 `PluginComponent`;fallback 文案复用 sidebar 的 `sidebar:panelError.failed` i18n key;留一个 dev-only 会 throw 的 demo 容器组件作 self-check。
**Consequences**: 文案在 markdown 场景下"面板加载失败"略不贴切但可接受;demo 组件常驻注册(开销极小)。未来若文案需要区分,再加专用 key。

## Requirements (evolving)

- Markdown 预览里任一插件容器组件 render 期 throw,不得冒泡到主 React 树。
- 出错时显示一个本地化的错误提示块,包含 plugin name + error.message。
- 不破坏现有 `data-container` div 结构(export DOM walk 依赖)。

## Acceptance Criteria (evolving)

- [ ] 插件容器组件 throw 时,markdown 预览其余部分正常渲染,主应用不白屏。
- [ ] fallback 块显示 plugin name + error.message。
- [ ] 现有 `data-container` 属性保留(export 增强器仍能定位)。
- [ ] dev-only demo 容器组件注册后,markdown 里写 `:::plugin-error-demo` 能触发 fallback 而不白屏。

## Definition of Done

- 类型检查 / lint 绿。
- dev-only demo 容器组件作为 self-check(ponytail:最小可验证)。

## Out of Scope (explicit)

- `ContainerRenderer.tsx` 死代码不动。
- 不改 sidebar / sandbox / tool window 已有隔离。
- 不引入远程日志上报。

## Technical Notes

- 关键文件:`apps/desktop/src/components/file-types/markdown/MarkdownPreview.tsx:71-87`
- 复用:`apps/desktop/src/components/sidebar/PanelErrorBoundary.tsx`
