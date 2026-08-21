# markdown 预览图片交互式拖拽缩放

## Goal

让 markdown 预览页里的图片和代码块图(mermaid / plantuml / graphviz)可以通过鼠标拖拽右下角手柄调整显示尺寸,并把结果持久化写回 md 源,跨会话/跨机器保留。

## Requirements

- 在 markdown 预览的 4 类渲染产物上挂角手柄:
  - 普通 md 图片(`![alt](src)` 经 `VaultImage`)
  - `mermaid` fence
  - `plantuml` fence
  - `graphviz` / `dot` fence
- 手柄出现在元素右下角;拖拽默认锁定宽高比例,按住 Shift 解锁;双击重置(清掉写入源文件的尺寸)。
- 拖拽结束后把新尺寸写回 md 源,走 `onChange(nextContent)`:
  - **图片**:改写为 `![alt](src =WxH)`(GFM 风格,regex 读写,不走 AST)
  - **fence**:改写 info string,`​```mermaid width=W`(首词之后加 `width=W`,已存在则原地替换)
- 初始渲染读源里已有的尺寸标注并应用,不依赖会话状态。
- 对没有 `sourceLine` / `content` / `onChange` 的场景(WikiQueryView 答案渲染、外部 md)降级为会话内缩放,不写回。

## Acceptance Criteria

- [ ] md 图片在预览里可见右下角手柄,拖拽改变显示宽高并保持比例
- [ ] 拖拽松手后,再次打开文件,尺寸仍生效(源里已写入 `=WxH`)
- [ ] 双击手柄清掉尺寸并从源里删除 `=WxH` 标注
- [ ] mermaid / plantuml / graphviz fence 同样可拖拽、持久化到 info string
- [ ] 按 Shift 拖拽时解锁比例
- [ ] WikiQueryView 里的 md 不崩(降级路径),不报写回错误

## Definition of Done

- 改动局限于 `MarkdownPreview.tsx` + `index.css`,不污染别的 file-type handler
- 不跑全项目编译(用户本地自测)
- 至少一个可运行验证路径(用户手工)

## Technical Approach

### 写回机制
复用 `CodeBlockWrapper.handleSync` 模式:从 `contentRef` 读整篇 md,在 `sourceLine` 处用 regex 替换目标行,调 `onChangeRef.current(next)`。

- 图片:`sourceLine` 来自 `rehypeSourceLine`(已在 pipeline),挂在 img 的 `data-source-line`。regex: `/!\[([^\]]*)\]\(([^)]+?)\s*(?:=\d*x\d*)?\)/` 替换为 `![\1](\2 =WxH)`
- fence:`sourceLine` 已在 `CodeBlockWrapper` 路径(行 618),`renderer.component` 当前没收到,需要透传。在 fence 起始行用 regex 替换 info string `​```(\w+)(?:\s+width=\d+)?` → `​```\1 width=W`

### ResizableMedia 组件
单个 React 组件 `<ResizableMedia src/text sourceLine content onChange>` 包裹任意 children(img 元素或 fence renderer 输出)。内部:
- `useState(width, height)` 初值从源里 parse 出来
- pointer events 实现拖拽,默认锁比例(等比),Shift 解锁
- 右下角 `<div className="resize-handle">`
- 拖拽结束(commit 阶段,不是 move 阶段)调写回

### 接入点
- `MarkdownPreview.tsx:587-609` `map['img']` 内,把 `<img>` 用 `<ResizableMedia>` 包起来
- `MarkdownPreview.tsx:620-628` fence 分发处,把 `createElement(renderer.component, ...)` 用 `<ResizableMedia>` 包起来,并多传 `sourceLine`

### 样式
- `index.css:530` `.md-preview img { max-width: 100% }` 保留作为兜底;`ResizableMedia` 内部容器用 `width: <state>px; height: auto`,内部 img/svg `width:100%; height:100%`。
- 新增 `.md-preview .resize-handle` 样式。

## Decision (ADR-lite)

**Context**: 用户既要交互式拖拽,又要跨机器持久化。会话内 ephemeral 不能满足;但代码块图无 GFM 标准语法承载尺寸。
**Decision**: 图片走 `=WxH`(GFM 风格,regex);fence 走 info string `width=W`(非标但明确)。都用 regex 在 sourceLine 处替换,不引入 AST 写回器。
**Consequences**: `=WxH` 和 `width=W` 是本项目自定义语义,其他 md 渲染器会忽略它们(不影响),但本项目需要持续维护这两个 regex。若未来想支持更多元素类型,扩展 ResizableMedia 的接入点即可。

## Out of Scope

- 语法式手写尺寸(用户拖拽,不要求手写 `=WxH`)
- 图片裁剪、旋转、滤镜
- markmap / 其他未列出的 fence 类型
- 同一图片在多个文件间的尺寸同步

## Technical Notes

- 文件参考:
  - `apps/desktop/src/components/file-types/markdown/MarkdownPreview.tsx:478` 入口
  - `MarkdownPreview.tsx:587-609` `VaultImage`
  - `MarkdownPreview.tsx:611-635` fence 分发(待透传 sourceLine 给 renderer)
  - `MarkdownPreview.tsx:236-350` `CodeBlockWrapper` 写回参考
  - `apps/desktop/src/index.css:530` `.md-preview img`
- 已在 pipeline:`remarkDirective` / `remarkRehype` / `rehypeRaw` / `rehypeSourceLine` / `rehypeReact`
- 依赖外部渲染器:`MermaidBlock` / `PlantUmlBlock` / `GraphvizBlock`(@quill/container-plugins),不改它们,只在 MarkdownPreview 调用点外包
