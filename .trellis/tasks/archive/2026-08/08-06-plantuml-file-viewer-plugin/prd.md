# PlantUML File Viewer Plugin

## Goal

作为 trusted-tier 插件新增 PlantUML 文件类型（`.puml` / `.plantuml` / `.pu`），支持 edit / split / preview 三种视图。渲染走 `plantuml-encoder` + 公共 plantuml.com server（方案 B，Ponytail 默认）。

## What I already know

* `FileTypeHandler` 契约在 `@quill/plugin-sdk/contracts.ts:45`，支持 `supportedViewModes`、`Editor`、`Preview`、`useCodeMirror`。
* Trusted-tier 适配器 `registerPluginFileTypes` 在 `apps/desktop/src/services/plugin-host/contributionAdapters.ts:119`；manifest `contributes.fileTypes[]` 的 `handler` entry-ref 索引 `module.handlers[entryRef]`。
* Trusted bundle 必须**自包含**：relative imports 在 blob URL 不解析，remote imports 被 CSP 拦截（`trustedLoader.ts:34`）。React + plantuml-encoder 都要打进 bundle。
* Shell 用 `useCodeMirror` 标志自带 CodeMirror 编辑器（`WorkArea.tsx:260`）—— 插件只需出 Preview 组件。
* `.puml` / `.plantuml` 当前由 `office/index.ts:34` 接管（只读 preview）。
* `HandlerRegistry` (`HandlerRegistry.ts:24`) 用 `extMap` 覆盖式注册：后注册者覆盖前者；dispose 只在仍是同一实例时移除（安全卸载）。
* 相似参考：`dbml/index.tsx`（split + 图渲染）、`drawio/`（edit + preview）。
* npm 无 `plantuml-core` 包；`plantuml-encoder@1.4.0` 已在 transitive node_modules。

## Requirements

* 插件目录：`examples/plugins/plantuml-viewer/`
* `manifest.json`：`tier: trusted`，`contributes.fileTypes[]` 声明 handler entry-ref。
* `src/index.tsx`：导出 `handlers.plantuml`（FileTypeHandler），含 Preview 组件。
* `build.mjs` + `package.json`：esbuild 打包 `src/index.tsx` → `dist/index.js`（单文件 ESM，React + plantuml-encoder 内联）。
* Handler：
  * `id: 'plantuml'`，`extensions: ['puml', 'plantuml', 'pu']`
  * `supportedViewModes: ['edit', 'split', 'preview']`，`defaultViewMode: 'split'`
  * `useCodeMirror: true`，`needsFileContent: true`
  * Preview 组件：encode → `<img src="https://www.plantuml.com/plantuml/svg/{encoded}">`，错误回退显示源码 + 提示，debounce 300ms。
* Tests：Preview 组件 encode/错误单测；handler 注册/卸载用 `HandlerRegistry` 直测；manifest schema 校验。

## Acceptance Criteria

* [ ] `pnpm build` 产出 `dist/index.js`，无 relative/remote imports。
* [ ] manifest 通过 `tier: trusted` + `contributes.fileTypes[]` schema 校验。
* [ ] `install_plugin` → `approve_plugin` → 加载后，打开 `.puml` 进入 split 视图。
* [ ] Edit/Split 模式 CodeMirror 可编辑源码、Cmd+S 保存（shell 自带，无需插件实现）。
* [ ] Preview 模式渲染出 SVG 图。
* [ ] Preview 错误分支：故意写错语法 → 显示源码 + 错误提示而非崩溃。
* [ ] 卸载插件后 `HandlerRegistry` 中 `plantuml` handler 被移除。
* [ ] 单元测试全绿；`pnpm lint` / `tsc` 通过。

## Definition of Done

* Tests added (Preview encode + 错误分支 + handler 注册/卸载)。
* `pnpm lint` / typecheck / build green。
* 插件目录在 `examples/plugins/plantuml-viewer/` 完整（manifest + src + build script + package.json）。
* 不修改 `office` handler（保持其他扩展名接管不变）。

## Technical Approach

### Bundle 自包含

esbuild 配置：
```js
esbuild.build({
  entryPoints: ['src/index.tsx'],
  bundle: true,
  format: 'esm',
  outfile: 'dist/index.js',
  external: [],  // 全部内联
  jsx: 'automatic',
  jsxImportSource: 'react',
})
```

### Preview 组件核心

```tsx
import { useEffect, useState } from 'react';
import plantumlEncoder from 'plantuml-encoder';

export default function PlantUmlPreview({ content }: { content: string }) {
  const [debounced, setDebounced] = useState(content);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(content), 300);
    return () => clearTimeout(t);
  }, [content]);
  const encoded = plantumlEncoder.encode(debounced);
  const url = `https://www.plantuml.com/plantuml/svg/${encoded}`;
  return <img src={url} onError={...} alt="PlantUML diagram" />;
}
```

### 注册流程

manifest → `registerPluginFileTypes` 合并 → `HandlerRegistry.register` 覆盖 `office` 对 `.puml/.plantuml/.pu` 的 extMap 项。卸载时 dispose 只移除 plantuml 自己的 extMap 项；office 的 id 仍在 `handlers` 中但 extMap 已无对应（重启 app 后 glob 重注册才恢复 `office → .puml`）—— MVP 已知限制。

## Decision (ADR-lite)

**Context**: 用户原意 "plantuml-core" 在 npm 不存在；用户提到 TeaVM+Viz.js 浏览器方案但无现成包。

**Decision**: 选方案 B（`plantuml-encoder` + 公共 plantuml.com server）。理由：最小依赖、Ponytail 默认、用户在 AskUserQuestion 中明确选定。

**Consequences**:
- 必须联网才能渲染；源码上传第三方 plantuml.com。
- 内网/敏感文档不可用（用户可在后续切换方案 A/C）。
- 包体小、实现短。

## Out of Scope

* 离线渲染（方案 A `@kookyleo/plantuml-little-web` 或方案 C TeaVM+Viz.js）。
* PlantUML 语法高亮（用 CodeMirror 默认 StreamLanguage 即可）。
* 修改 `office` handler 扩展名列表（保持不动；卸载后 extMap 残留问题留作后续）。
* PlantUML 主题/皮肤切换。
* 多文件 `!include` 解析。

## Technical Notes

* 注册入口：`contributionAdapters.ts:119` `registerPluginFileTypes`。
* Shell 编辑器路由：`WorkArea.tsx:260` 按 `useCodeMirror` 自动出 CodeMirror。
* Bundle 自包含约束：`trustedLoader.ts:34` 注释。
* extMap 覆盖语义：`HandlerRegistry.ts:24`。
* plantuml-encoder API：`encode(text)` → URL-safe 段；拼前缀 `https://www.plantuml.com/plantuml/svg/{段}` 即可得 SVG URL。

## Implementation Plan

* Step 1: 插件骨架 — 目录、`manifest.json`、`package.json`、`src/index.tsx`（handler + Preview 组件）、`build.mjs`。
* Step 2: 测试 — `src/index.test.tsx`（Preview encode/错误分支 + handler 注册 dispose 用 `HandlerRegistry`）。
* Step 3: 集成验证 — `pnpm build` 出 `dist/index.js`，确认无 external import；跑 `pnpm test` + `pnpm lint`。
