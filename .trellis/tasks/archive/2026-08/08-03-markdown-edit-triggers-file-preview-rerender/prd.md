# Markdown 编辑触发 file-preview 全量重渲染

## Goal

修复 Markdown 预览中每输入一个字符就重渲染所有 `:::file-preview` 块的性能问题。当前每次按键都会重建组件映射、重跑整条 unified 解析管线、并通过 VaultContext 触发所有 file-preview 块重新读文件 + 重新渲染预览组件（excalidraw/dbml/mermaid 等重组件），导致明显卡顿。

## What I already know

根因（已通过读源码确认，三层叠加）：

1. **`MarkdownPreview.tsx:544`** — `componentMap` 的 `useMemo` 依赖 `content` 和 `onChange`。每次按键 `content` 变化 → 整个 `componentMap` 重建（每个 wrapper 函数都是新引用）→ `reactContent`（548-575）的 `useMemo` 因 `componentMap` 引用变化重跑整条 unified pipeline（remarkParse → ... → rehypeReact），全文档重新解析为新的 React 元素树。

2. **`MarkdownPreview.tsx:578`** — `VaultContext.Provider value={{...}}` 每次渲染都是新对象引用。所有 `FilePreviewComponent` 的 `useEffect([src, ctx])`（FilePreviewPlugin.tsx:89）因 `ctx` 引用变更重新触发 → 重新调用 `ctx.readFile` → 重新调用 `ctx.renderFile` → 重挂载预览组件。

3. 叠加效果：每次按键 = 全文档重解析 + 所有 file-preview 块卸载重挂数据流 + 重组件重新渲染。

## Requirements

- 编辑 Markdown 时，`:::file-preview` 块不应重新读文件或重新挂载预览组件。
- 解析管线对 `body` 的重跑不可避免（编辑就是改 body），但要确保 React 协调能复用现有元素实例而不是强制重挂。
- 不引入额外依赖、不改变现有 API（`PreviewProps`、`ContainerProps`、`VaultContextValue` 均保持不变）。
- 不改变 file-preview 的语义、视觉、交互。
- 不引入节流/防抖（治标不治本，且增加延迟）。

## Acceptance Criteria

- [ ] 在含 1+ 个 `:::file-preview` 块的 Markdown 文档中连续输入字符，FilePreviewComponent 的 `useEffect([src, ctx])` 不重新触发（无重复 readFile 调用）。
- [ ] `componentMap` 的 `useMemo` 依赖数组不再包含 `content` / `onChange`。
- [ ] `VaultContext.Provider` 的 value 用 `useMemo` 包装，依赖仅为 `filePath` / `resolvedVaultRoot` / `renderFile` 等真正会变的状态。
- [ ] code-block 的 Run / Sync 功能仍正常（`content` / `onChange` 通过 ref 传递）。
- [ ] 标题锚点、图片路径解析、Mermaid、excalidraw 嵌入、html 预览切换等其他功能不回归。

## Definition of Done

- Lint / typecheck / build 通过
- 手动验证：在含 file-preview 的文档中编辑流畅，DevTools Profiler 中 file-preview 不再每次按键都重新挂载
- 无新增依赖

## Technical Approach

**Approach A: 稳定 componentMap + 稳定 VaultContext value（推荐）**

- 把 `content` 和 `onChange` 移入 `useRef`，每次渲染同步赋值（不触发重渲染）。`map['pre']` 的 `PreWithMermaid` 从 `contentRef.current` / `onChangeRef.current` 读取，闭包不再捕获这两个值。
- `componentMap` 的 `useMemo` 依赖改为 `[filePath, vaultRoot, resolvedVaultRoot, assetBase]`（移除 `content, onChange`）。
- `VaultContext.Provider value` 用 `useMemo` 包装，依赖 `[filePath, resolvedVaultRoot, renderFile]`。`readFile` 是稳定 import（`readFileByRoute`），`getFileIcon` 内联 createElement 不依赖任何 state，可抽出为模块级常量函数或放进 useCallback。
- 效果：按键只让 `body` 变 → `reactContent` 重跑（必须），但 `componentMap` 引用稳定 → rehypeReact 的组件函数稳定 → React 协调能复用 FilePreviewComponent 实例；VaultContext value 稳定 → FilePreviewComponent 的 effect 不重跑 → 不重读文件、不重挂预览。

**Why not Approach B（防抖解析）**：增加输入延迟，治标不治本，且 file-preview 块在停止输入后仍会全量重渲染。

**Why not Approach C（拆分 file-preview 到独立组件树）**：file-preview 是 markdown 指令的一部分，无法在解析阶段拆出，改动巨大。

## Decision (ADR-lite)

**Context**: 编辑 Markdown 时全量重渲染 file-preview 块导致卡顿。

**Decision**: Approach A — 通过 ref 解耦 `content`/`onChange` 与 `componentMap`，并 memo 化 VaultContext value，根因层面消除不必要的重渲染。

**Consequences**:
- 优点：最小 diff、无新依赖、根因修复、其他重渲染场景也受益（标题锚点等）。
- 风险：ref 模式需保证 `map['pre']` 在 effect/事件回调里读 ref 而不是闭包变量；如果未来有人在 componentMap 里又加了捕获 state 的 wrapper，需要同样处理。
- 已知残留：`body` 改变仍会重跑 unified pipeline（O(n) 文本解析），这对正常长度文档可接受；若日后超长文档仍卡，再考虑分块解析或 Web Worker。

## Out of Scope

- Markdown 解析的 Web Worker 化或分块增量解析（如未来超长文档仍卡再做）。
- `CodeBlockWrapper` 内部状态（lineCount、running、stdout 等）的重渲染优化 — 不在本次根因范围内。
- Mermaid / excalidraw 自身的渲染性能优化。

## Technical Notes

- 关键文件：
  - `apps/desktop/src/components/file-types/markdown/MarkdownPreview.tsx`（核心修复点）
  - `packages/container-plugins/src/plugins/FilePreviewPlugin.tsx`（验证 effect 不重跑）
  - `packages/container-plugins/src/VaultContext.ts`（context 定义，不改）
- 约束：`ContainerProps` / `VaultContextValue` 接口保持不变，不动 packages/container-plugins 的对外 API。
- 验证手段：React DevTools Profiler + 在 FilePreviewComponent 的 useEffect 里加临时 console.log 看是否每次按键触发。
