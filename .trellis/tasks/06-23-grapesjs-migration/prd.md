# graceful-drifting-rabbit

# GrapesJS 集成技术方案

## 一、背景与目标

Quill 是一个 Tauri 2 + React 18 + TypeScript 桌面 Markdown 编辑器，已有基于 iframe + bridge 的 HTML 可视化编辑能力。当前实现共 ~1,945 行代码（bridge.ts 839行 + VisualEditCanvas.tsx 687行 + PropertiesPanel.tsx 419行），支持元素选择、拖拽、文字编辑和基础样式修改。

**目标**：用 GrapesJS 替换现有 Visual 模式，获得完整的页面构建器能力，同时保持 Source 模式和 Preview 模式不变。

**预期收益**：
- 减少 ~885 行自维护代码（删除 1,945 行，新增 ~1,060 行）
- 获得 GrapesJS 生态的全部能力（Style Manager、Layer Manager、Block Library、Responsive、Rich Text Editor 等）
- 从快照式 Undo/Redo（50步上限）升级为 GrapesJS 细粒度 UndoManager

---

## 二、整体架构

### 2.1 现有架构

```
HtmlVisualEditor.tsx (91行，三模式容器)
├── mode === 'visual'  → VisualEditCanvas.tsx (687行)
│                         ├── iframe (srcDoc渲染)
│                         ├── bridge.ts (839行，注入到iframe)
│                         ├── Host Overlay (选择框/拖拽线/Tooltip)
│                         └── PropertiesPanel.tsx (419行)
├── mode === 'source'  → SourceEditCanvas.tsx (119行, CodeMirror)
└── mode === 'preview' → iframe (srcDoc)
```

### 2.2 目标架构

```
HtmlVisualEditor.tsx (修改，~100行)
├── mode === 'visual'  → GrapesEditor.tsx (新建, ~250行)
│                         ├── 左侧栏: BlockManager 面板
│                         ├── 中央: GrapesJS Canvas (iframe，GrapesJS自管理)
│                         └── 右侧栏: 样式/图层/属性 三Tab面板
├── mode === 'source'  → SourceEditCanvas.tsx (不变)
└── mode === 'preview' → iframe (不变)
```

### 2.3 数据流

```
磁盘文件 (raw HTML)
  │ editorStore.openFile()
  ▼
tab.content (完整 HTML 字符串)
  │ HtmlVisualEditor 接收 content prop
  ▼
parseHtmlForGrapes(content)
  │ 分离 doctype/head/style/body/script
  ▼
editor.setComponents(bodyHtml)  +  editor.setStyle(cssRules)
  │ 用户在 GrapesJS 中编辑
  ▼
GrapesJS 事件 (component:update, style:update, ...)
  │ 防抖 500ms
  ▼
extractContent()
  │ editor.getHtml() + editor.getCss()
  │ reconstructHtml(parsed, html, css)
  ▼
onChange(fullHtmlString)
  │ editorStore.updateTabContent()
  ▼
自动保存 → vault.writeFile()
```

---

## 三、文件变更清单

### 3.1 新建文件

| 文件路径 | 职责 | 预估行数 |
|---------|------|---------|
| `html/GrapesEditor.tsx` | GrapesJS React 容器组件，三栏布局 + 工具栏 | ~250 |
| `html/useGrapesEditor.ts` | React Hook：GrapesJS 生命周期、事件、销毁 | ~180 |
| `html/grapesConfig.ts` | 初始化配置：Style Manager sectors、设备、面板 | ~200 |
| `html/grapesBlocks.ts` | 自定义 Block 定义（标题/段落/按钮/卡片等） | ~150 |
| `html/grapesContentPipeline.ts` | HTML 解析与重建（parseHtmlForGrapes / reconstructHtml） | ~100 |
| `html/grapesTheme.css` | GrapesJS 深色/浅色主题覆盖样式 | ~180 |

所有文件路径基于 `apps/desktop/src/components/file-types/html/`。

### 3.2 修改文件

| 文件 | 变更内容 |
|------|---------|
| `html/HtmlVisualEditor.tsx` | 将 `VisualEditCanvas` 替换为 `GrapesEditor`，增加工具栏按钮（设备切换、Undo/Redo、源码查看） |
| `apps/desktop/package.json` | 添加 `grapesjs@^0.21.13` 和 `grapesjs-blocks-basic@^1.0.2` 依赖 |
| `apps/desktop/vite.config.ts` | manualChunks 增加 `'grapesjs': ['grapesjs']` 用于代码分割 |

### 3.3 删除文件（迁移完成后）

| 文件 | 行数 | 说明 |
|------|------|------|
| `html/bridge.ts` | 839 | iframe 注入脚本，被 GrapesJS 内置交互完全取代 |
| `html/VisualEditCanvas.tsx` | 687 | 自定义画布 + Overlay，被 GrapesJS Canvas 取代 |
| `html/PropertiesPanel.tsx` | 419 | 属性面板，被 GrapesJS Style/Trait Manager 取代 |

---

## 四、核心模块设计

### 4.1 GrapesEditor.tsx — React 容器组件

```tsx
interface GrapesEditorProps {
  content: string;
  onChange: (content: string) => void;
}

export function GrapesEditor({ content, onChange }: GrapesEditorProps)
```

**布局结构**：

```
┌─────────────────────────────────────────────────────┐
│ 工具栏: [🖥桌面|📱平板|📲手机]  [↩撤销|↪重做]  [{}源码|⬆导入] │
├──────────┬─────────────────────────┬────────────────┤
│ 组件库    │                         │ [样式|图层|属性] │
│ (220px)  │    GrapesJS Canvas       │    (260px)     │
│          │    (flex: 1)             │                │
│ ──────── │                         │ Style Manager  │
│ 文本      │                         │ 或 Layers 或   │
│  标题     │                         │ Trait Manager  │
│  段落     │                         │                │
│  按钮     │                         │                │
│ ──────── │                         │                │
│ 布局      │                         │                │
│  卡片     │                         │                │
│  Hero    │                         │                │
│  分割线   │                         │                │
└──────────┴─────────────────────────┴────────────────┘
```

**关键 DOM ref**：

```tsx
const containerRef = useRef<HTMLDivElement>(null);  // GrapesJS canvas 容器
const blocksRef = useRef<HTMLDivElement>(null);     // BlockManager 挂载点
const stylesRef = useRef<HTMLDivElement>(null);     // StyleManager 挂载点
const selectorsRef = useRef<HTMLDivElement>(null);  // SelectorManager 挂载点
const layersRef = useRef<HTMLDivElement>(null);     // LayerManager 挂载点
const traitsRef = useRef<HTMLDivElement>(null);     // TraitManager 挂载点
```

**Tailwind 类名遵循项目约定**：`bg-panel`, `border-brd`, `text-t3`, `text-acc`, `bg-hov` 等。

### 4.2 useGrapesEditor.ts — 生命周期 Hook

```tsx
export function useGrapesEditor(options: {
  containerRef: RefObject<HTMLElement>;
  blocksRef: RefObject<HTMLElement>;
  stylesRef: RefObject<HTMLElement>;
  selectorsRef: RefObject<HTMLElement>;
  layersRef: RefObject<HTMLElement>;
  traitsRef: RefObject<HTMLElement>;
  content: string;
  onChange: (content: string) => void;
}): {
  editor: grapesjs.Editor | null;
  undo: () => void;
  redo: () => void;
  setDevice: (device: string) => void;
  showCode: () => void;
  importHtml: () => void;
  canUndo: boolean;
  canRedo: boolean;
  isReady: boolean;
}
```

**核心逻辑**：

1. **初始化**（useEffect，mount-once）：
   ```typescript
   const gjsEditor = grapesjs.init(createGrapesConfig({
     container: containerRef.current!,
     blocksContainer: blocksRef.current!,
     stylesContainer: stylesRef.current!,
     selectorsContainer: selectorsRef.current!,
     layersContainer: layersRef.current!,
     traitsContainer: traitsRef.current!,
   }));
   ```

2. **加载内容**：
   ```typescript
   const parsed = parseHtmlForGrapes(content);
   parsedRef.current = parsed;
   gjsEditor.setComponents(parsed.bodyContent);
   gjsEditor.setStyle(parsed.styleBlocks.join('\n'));
   // 注入外部 <link> 标签到 canvas iframe
   gjsEditor.on('load', () => {
     injectExternalLinks(gjsEditor, parsed.headContent);
   });
   ```

3. **监听变更**（防抖 500ms，与现有 bridge 一致）：
   ```typescript
   const CHANGE_EVENTS = [
     'component:update', 'component:add', 'component:remove',
     'component:drag:end', 'component:styleUpdate',
     'style:custom', 'undo', 'redo'
   ];
   CHANGE_EVENTS.forEach(evt => {
     gjsEditor.on(evt, scheduleContentExtraction);
   });
   ```

4. **内容提取**：
   ```typescript
   function scheduleContentExtraction() {
     clearTimeout(debounceTimer.current);
     debounceTimer.current = setTimeout(() => {
       const html = editorRef.current!.getHtml();
       const css = editorRef.current!.getCss();
       const full = reconstructHtml(parsedRef.current!, html, css);
       onChangeRef.current(full);
     }, 500);
   }
   ```

5. **清理**（useEffect cleanup）：
   ```typescript
   return () => {
     // 刷新最终内容
     clearTimeout(debounceTimer.current);
     const html = editorRef.current!.getHtml();
     const css = editorRef.current!.getCss();
     const final = reconstructHtml(parsedRef.current!, html, css);
     onChangeRef.current(final);
     editorRef.current!.destroy();
   };
   ```

### 4.3 grapesConfig.ts — 初始化配置

```typescript
export function createGrapesConfig(opts: GrapesInitOptions): Record<string, any> {
  return {
    container: opts.container,
    height: '100%',
    width: 'auto',
    fromElement: false,
    storageManager: false,           // Quill 的 Zustand store 管理持久化
    panels: { defaults: [] },        // 禁用内置面板，由 React 渲染

    blockManager: { appendTo: opts.blocksContainer },
    styleManager: { appendTo: opts.stylesContainer, sectors: STYLE_SECTORS },
    selectorManager: { appendTo: opts.selectorsContainer },
    layerManager: { appendTo: opts.layersContainer },
    traitManager: { appendTo: opts.traitsContainer },

    deviceManager: {
      devices: [
        { name: 'Desktop', width: '' },
        { name: 'Tablet', width: '768px', widthMedia: '992px' },
        { name: 'Mobile portrait', width: '375px', widthMedia: '480px' },
      ],
    },

    canvas: {
      styles: ['https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap'],
    },

    plugins: [blocksBasicPlugin],
    pluginsOpts: {
      [blocksBasicPlugin]: {
        flexGrid: true,
        category: '基础',
      },
    },
  };
}
```

**Style Manager Sectors**（6大类，完整覆盖 CSS 属性）：

| 分类 | 中文名 | 属性 |
|------|--------|------|
| Typography | 排版 | font-family, font-size, font-weight, line-height, letter-spacing, color, text-align, text-decoration, text-transform |
| Background | 背景 | background-color, background-image, background-repeat, background-position, background-size |
| Dimensions | 尺寸 | width, min/max-width, height, min/max-height |
| Spacing | 间距 | margin（复合属性，4方向）, padding（复合属性，4方向） |
| Border | 边框 | border-radius, border（复合）, box-shadow |
| Layout | 布局 | display, flex-direction, justify-content, align-items, flex-wrap, gap, position, overflow, opacity |

**vs 现有 PropertiesPanel 对比**：

| 属性 | 现有（PropertiesPanel） | GrapesJS Style Manager |
|------|------------------------|----------------------|
| font-family | 无 | 有，含字体下拉选择 |
| font-size | 有（number input） | 有（带单位选择 px/em/rem/%） |
| font-weight | 有（下拉 100-900） | 有 |
| line-height | 无 | 有 |
| letter-spacing | 无 | 有 |
| color | 有（color picker） | 有（更丰富的颜色选择器） |
| text-align | 无 | 有（图标按钮组） |
| background-color | 有 | 有 |
| background-image | 无 | 有（支持渐变编辑） |
| width/height | 有（number input） | 有（带单位选择） |
| margin | 有（4方向独立） | 有（复合属性，可视化 box model） |
| padding | 有（4方向独立） | 有（复合属性，可视化 box model） |
| border-radius | 有（单值） | 有（可 4角独立） |
| border | 无 | 有（width + style + color） |
| box-shadow | 无 | 有（支持多重阴影） |
| display | 无 | 有 |
| flex 相关 | 无 | 有（6个属性） |
| position | 有（X/Y坐标） | 有（static/relative/absolute/fixed） |
| opacity | 无 | 有 |
| overflow | 无 | 有 |

### 4.4 grapesContentPipeline.ts — HTML 解析与重建

```typescript
export interface ParsedHtml {
  doctype: string;        // "<!DOCTYPE html>" 或空
  htmlAttrs: string;      // <html> 标签上的属性 (lang, class等)
  headContent: string;    // <meta>, <title>, <link> (不含 <style>)
  styleBlocks: string[];  // <style> 标签内容数组
  bodyContent: string;    // <body> 的 innerHTML
  bodyAttrs: string;      // <body> 标签上的属性
  scriptBlocks: string[]; // <script> 标签完整内容（安全保存，不执行）
}

export function parseHtmlForGrapes(rawHtml: string): ParsedHtml
export function reconstructHtml(parsed: ParsedHtml, grapesHtml: string, grapesCss: string): string
```

**parseHtmlForGrapes 实现要点**：

1. 使用 `DOMParser.parseFromString(rawHtml, 'text/html')` 解析
2. 提取 doctype：检查 `doc.doctype`
3. 提取 `<html>` 属性：遍历 `doc.documentElement.attributes`
4. 分离 `<head>` 内容：
   - 遍历 `doc.head.childNodes`
   - `<style>` 标签 → `styleBlocks[]`
   - `<script>` 标签 → `scriptBlocks[]`
   - 其他（meta/title/link）→ `headContent`
5. 提取 `<body>`：
   - `bodyContent = doc.body.innerHTML`
   - `bodyAttrs` 从 `doc.body.attributes` 拼接
6. 移除 body 中的 `<script>` 标签 → `scriptBlocks[]`

**reconstructHtml 实现要点**：

```typescript
export function reconstructHtml(
  parsed: ParsedHtml,
  grapesHtml: string,
  grapesCss: string,
): string {
  const doctype = parsed.doctype || '<!DOCTYPE html>';
  const htmlOpen = parsed.htmlAttrs ? `<html ${parsed.htmlAttrs}>` : '<html>';
  const bodyOpen = parsed.bodyAttrs ? `<body ${parsed.bodyAttrs}>` : '<body>';

  // 合并 CSS：GrapesJS 生成的 + 原始 style 块
  const allCss = [grapesCss, ...parsed.styleBlocks]
    .filter(Boolean)
    .join('\n');

  const scripts = parsed.scriptBlocks
    .map(s => `<script>${s}</script>`)
    .join('\n');

  return `${doctype}
${htmlOpen}
<head>
${parsed.headContent}
<style>
${allCss}
</style>
</head>
${bodyOpen}
${grapesHtml}
${scripts}
</body>
</html>`;
}
```

### 4.5 grapesBlocks.ts — 自定义 Block 定义

```typescript
export function registerCustomBlocks(editor: grapesjs.Editor): void
```

**Block 列表**：

| 类别 | Block | 内容 |
|------|-------|------|
| 文本 | 标题 | `<h2>` 带 padding 和字号 |
| 文本 | 段落 | `<p>` 带 line-height 和颜色 |
| 文本 | 按钮 | `<a>` 样式化为按钮（圆角、accent 色） |
| 文本 | 列表 | `<ul>` 含 3 个 `<li>` |
| 文本 | 引用 | `<blockquote>` 带左侧 accent 边框 |
| 布局 | 卡片 | div 含图片 + 标题 + 描述 + 圆角阴影 |
| 布局 | Hero 区域 | section 渐变背景 + h1 + p + CTA 按钮 |
| 布局 | 分割线 | `<hr>` 样式化 |
| 布局 | 间距 | 空 div，可调高度 |

`grapesjs-blocks-basic` 已提供：1/2/3 栏 flex 布局、文本、链接、图片、视频、地图。

### 4.6 grapesTheme.css — 主题适配

通过 CSS 变量映射，让 GrapesJS UI 自动跟随 Quill 的 light/dark 主题切换：

```css
/* GrapesJS 主背景 → Quill panel 色 */
.gjs-one-bg { background-color: var(--panel) !important; }

/* GrapesJS 文字色 → Quill t2 */
.gjs-two-color { color: var(--t2) !important; }

/* GrapesJS 强调背景 → Quill acc */
.gjs-three-bg { background-color: var(--acc) !important; }

/* GrapesJS 强调文字 → Quill acc */
.gjs-four-color,
.gjs-four-color-h:hover { color: var(--acc) !important; }

/* Canvas 背景 → Quill surf2 */
.gjs-cv-canvas { background: var(--surf2) !important; }

/* Block 组件 → 使用 Quill 的面板/边框/hover 色 */
.gjs-block {
  background: var(--surf) !important;
  border: 1px solid var(--brd) !important;
  border-radius: 8px !important;
  color: var(--t2) !important;
}
.gjs-block:hover {
  background: var(--hov) !important;
  border-color: var(--acc) !important;
}

/* 输入框 → Quill inp 色 */
.gjs-field {
  background: var(--inp) !important;
  border: 1px solid var(--brd) !important;
  color: var(--t1) !important;
}
.gjs-field input,
.gjs-field select { color: var(--t1) !important; }

/* Style Manager 标签 → Quill t3 */
.gjs-sm-label { color: var(--t3) !important; }
.gjs-sm-sector .gjs-sm-sector-title {
  background: var(--surf2) !important;
  color: var(--t2) !important;
}

/* 选中/hover 组件 → Quill acc 色 */
.gjs-selected { outline: 2px solid var(--acc) !important; }
.gjs-hovered { outline: 1px dashed var(--acc) !important; }
.gjs-toolbar { background: var(--acc) !important; }

/* Layer Manager → Quill 色系 */
.gjs-layer-name { color: var(--t2) !important; }
.gjs-layer.gjs-selected .gjs-layer-name { color: var(--acc) !important; }
.gjs-layers { background: var(--panel) !important; }

/* Modal → Quill panel 色 */
.gjs-mdl-dialog { background: var(--panel) !important; border-radius: 12px !important; }
.gjs-mdl-header { background: var(--surf2) !important; color: var(--t1) !important; }
.gjs-mdl-bg { background: rgba(0,0,0,0.5) !important; }

/* 滚动条 → 与 Quill 全局一致 */
/* 已由 index.css 全局 ::-webkit-scrollbar 覆盖 */
```

**主题切换机制**：由于所有覆盖都引用 `var(--xxx)` CSS 变量，当 `[data-theme]` 切换时，颜色自动更新，无需 JavaScript 干预。

---

## 五、模式切换策略

### 5.1 Visual → Source

```
GrapesEditor 即将 unmount
  ↓ useEffect cleanup
提取 editor.getHtml() + editor.getCss()
  ↓ reconstructHtml()
更新 currentContentRef.current
  ↓ onChange()
editor.destroy()
  ↓
SourceEditCanvas mount
  ↓ 读取 currentContentRef.current
CodeMirror 显示最新 HTML 源码
```

### 5.2 Source → Visual

```
SourceEditCanvas 正常 unmount
  ↓ 已通过 onChange 持续更新 currentContentRef
GrapesEditor mount
  ↓ useGrapesEditor 初始化
parseHtmlForGrapes(currentContentRef.current)
  ↓
editor.setComponents(bodyHtml)
editor.setStyle(cssRules)
  ↓
GrapesJS 渲染画布
```

### 5.3 外部内容更新

当文件在磁盘被外部修改时，`editorStore` 的 `externalContentVersion` 递增。`WorkArea.tsx` 已使用 `key={tabId}-${version}` 模式，导致 `HtmlVisualEditor` 整体重新挂载，GrapesJS 用新内容重新初始化。

### 5.4 HtmlVisualEditor.tsx 修改后的结构

```tsx
import { GrapesEditor } from './GrapesEditor';

export function HtmlVisualEditor({ content, onChange }: EditorProps) {
  const [mode, setMode] = useState<EditorMode>('visual');
  const currentContentRef = useRef(content);

  const handleChange = useCallback((newContent: string) => {
    currentContentRef.current = newContent;
    onChange(newContent);
  }, [onChange]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* 模式切换工具栏 — 保持不变 */}
      <div className="shrink-0 bg-panel border-b border-brd flex gap-1 p-1">
        {/* visual / source / preview 按钮 */}
      </div>

      {/* Canvas 区域 */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {mode === 'visual' && (
          <GrapesEditor
            content={currentContentRef.current}
            onChange={handleChange}
          />
        )}
        {mode === 'source' && (
          <SourceEditCanvas
            content={currentContentRef.current}
            onChange={handleChange}
          />
        )}
        {mode === 'preview' && (
          <iframe ... srcDoc={currentContentRef.current} />
        )}
      </div>
    </div>
  );
}
```

---

## 六、边界场景处理

### 6.1 Script 标签安全

| 阶段 | 行为 |
|------|------|
| 加载 | `parseHtmlForGrapes` 提取所有 `<script>` 存入 `scriptBlocks[]`，不传给 GrapesJS |
| 编辑 | GrapesJS canvas iframe 不含任何脚本，安全沙箱环境 |
| 保存 | `reconstructHtml` 在 `</body>` 前重新插入原始脚本 |
| 效果 | 脚本在文件中保留，但编辑器中从不执行（与现有行为一致） |

### 6.2 外部 CSS（`<link>` 标签）

GrapesJS canvas 是 iframe，不继承宿主 CSS。需在 editor load 后注入：

```typescript
editor.on('load', () => {
  const canvasDoc = editor.Canvas.getDocument();
  const linkTags = parsed.headContent.match(/<link[^>]+>/g) || [];
  linkTags.forEach(tag => {
    const tmp = document.createElement('div');
    tmp.innerHTML = tag;
    canvasDoc.head.appendChild(canvasDoc.importNode(tmp.firstChild!, true));
  });
});
```

### 6.3 GrapesJS 输出清洁性

| 方面 | 说明 |
|------|------|
| `editor.getHtml()` | 输出纯净 HTML，不含 GrapesJS 内部类名（gjs-selected 等） |
| `editor.getCss()` | 输出用户样式 + GrapesJS 生成的类样式 |
| 无需手动清理 | 对比现有 `stripBridgeArtifacts()` 需要移除 data-quill-id / 注入脚本等，GrapesJS 的序列化天然干净 |

### 6.4 大文件性能

- GrapesJS 解析 HTML 为组件树是一次性开销
- 可增加 loading 状态：`editor.on('load', () => setIsReady(true))`
- 拖拽期间 GrapesJS 内部使用 `requestAnimationFrame` 节流

### 6.5 特殊 HTML 结构

| 结构 | GrapesJS 行为 |
|------|--------------|
| Web Components / 自定义标签 | 作为通用组件处理，可移动/缩放 |
| SVG | 作为不透明块处理，可移动/缩放但不可编辑内部 |
| iframe（内容中的） | 正常渲染，内部不可编辑 |
| CSS 变量（var()） | 保留在样式中 |
| @import / @media | 保留在 CSS 输出中 |
| 模板语法（{{}}、Jinja等） | 作为文本保留 |

---

## 七、依赖变更

### 7.1 新增依赖

```json
// apps/desktop/package.json
{
  "dependencies": {
    "grapesjs": "^0.21.13",
    "grapesjs-blocks-basic": "^1.0.2"
  }
}
```

**不使用 `grapesjs-preset-webpage`**，原因：
- 它捆绑了 navbar、countdown、forms 等不必要的组件
- 基础 blocks 由 `grapesjs-blocks-basic` 提供
- 自定义 blocks 由 `grapesBlocks.ts` 提供
- Style Manager sectors 由 `grapesConfig.ts` 精确配置

### 7.2 打包优化

```typescript
// vite.config.ts → rollupOptions.output.manualChunks
{
  'codemirror': [...],   // 已有
  'rehype': [...],       // 已有
  'grapesjs': ['grapesjs'],  // 新增，独立 chunk
}
```

GrapesJS 核心约 190KB gzipped，独立 chunk 可实现按需加载（仅打开 HTML 文件时加载）。

---

## 八、迁移计划

### Phase 1：基础设施（不影响现有功能）

1. 添加 npm 依赖
2. 修改 vite.config.ts 增加代码分割
3. 创建 `grapesContentPipeline.ts`（纯函数，可单元测试）
4. 创建 `grapesBlocks.ts`
5. 创建 `grapesConfig.ts`
6. 创建 `grapesTheme.css`

### Phase 2：构建 React 封装

1. 创建 `useGrapesEditor.ts`
2. 创建 `GrapesEditor.tsx`
3. 导入 `grapesjs/dist/css/grapes.min.css`

### Phase 3：集成（Feature Flag 切换）

```typescript
// HtmlVisualEditor.tsx 临时 flag
const USE_GRAPES = true;

{mode === 'visual' && (
  USE_GRAPES
    ? <GrapesEditor content={...} onChange={...} />
    : <VisualEditCanvas content={...} onChange={...} />
)}
```

**验证清单**：
- [ ] 打开 HTML 文件 → Visual 模式正常渲染
- [ ] 从左侧拖拽 Block 到画布
- [ ] 选中元素 → 右侧 Style Manager 显示属性
- [ ] 修改字号/颜色/背景 → onChange 触发
- [ ] 切换到 Source 模式 → 源码干净无 GrapesJS 残留
- [ ] Source 中编辑 → 切回 Visual → 内容同步
- [ ] Preview 模式 → 准确渲染
- [ ] Undo/Redo → 功能正常
- [ ] 设备切换 → 画布宽度变化
- [ ] 打开含 `<script>` 的 HTML → 脚本不执行
- [ ] 保存后重新打开 → `<script>` 保留
- [ ] 深色/浅色主题切换 → GrapesJS UI 颜色跟随
- [ ] 大文件（500+ 元素）→ 可接受的加载时间

### Phase 4：清理

1. 移除 Feature Flag
2. 删除 `bridge.ts`, `VisualEditCanvas.tsx`, `PropertiesPanel.tsx`

### Phase 5：打磨

1. 微调主题 CSS 与 Quill 设计系统精确匹配
2. 所有 GrapesJS 面板标题改为中文
3. 可选：添加 `grapesjs-plugin-forms`（表单组件）
4. 可选：添加 `grapesjs-tui-image-editor`（图片编辑）

---

## 九、能力对比总结

| 能力 | 现有实现 | GrapesJS 方案 |
|------|---------|--------------|
| 元素选择与高亮 | bridge.ts 自研 | 内置，更精确 |
| 拖拽移动 | bridge.ts lerp + snap | 内置 Sorter + ComponentDrag |
| 文字编辑 | contentEditable 自研 | 内置 Rich Text Editor |
| 样式编辑 | 10 个属性 | 30+ CSS 属性，含渐变/阴影/flex |
| Block 组件库 | 无 | 内置 BlockManager + 自定义 blocks |
| 图层管理 | 无 | 内置 LayerManager（DOM 树视图） |
| 响应式预览 | 无 | 内置 DeviceManager（桌面/平板/手机） |
| HTML 属性编辑 | 无 | 内置 TraitManager |
| Undo/Redo | 50步快照栈 | 细粒度 UndoManager，无步数上限 |
| CSS Selector 管理 | 无 | 内置 SelectorManager |
| 源码查看/编辑 | SourceEditCanvas | 保持不变 + GrapesJS Modal 增强 |
| 代码输出清洁性 | stripBridgeArtifacts() 复杂清理 | getHtml()/getCss() 天然干净 |
| 维护成本 | 1,945 行自研代码 | ~1,060 行集成代码 + GrapesJS 社区维护 |