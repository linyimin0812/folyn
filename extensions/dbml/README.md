# DBML Extension

Folyn 的 **DBML** 数据库建模文件类型扩展（独立于 file-viewer）。

- `.dbml` 文件：CodeMirror 文本编辑 + ER 图实时预览 + 拖拽写回布局
- 解析用 `@dbml/core`（antlr4 SQL，~16M），渲染用 `@antv/x6`——全部在扩展自己的
  `folyn-extension://` iframe 里跑，**不进主应用**（主应用移除了这俩重依赖，瘦身 ~16M）

## 架构

```
宿主 realm (trusted, blob-URL)
  └─ DbmlFrame  ── postMessage {content, theme} ──┐  (实时编辑器文本)
        │  ← postMessage {content: 含 meta 的回写}  │  (拖拽布局写回 → onChange → 编辑器)
        ▼                                       │
folyn-extension://localhost/<id>/dbml-preview.html
  └─ ErDiagramX6 (@dbml/core parse + @antv/x6 render)
```

## 文件类型 modes
- `edit` — host CodeMirror（shell-editor，核心独占）
- `split` — CodeMirror | DbmlFrame（ER 预览）
- `preview` — DbmlFrame（ER 图，默认 split）

## 构建

```bash
pnpm install
pnpm build   # 产出 dist/（index.js + dbml-preview.html + assets/ + manifest.json）
```

Folyn → 插件 → 从文件夹安装 → 选 `extensions/dbml/dist/`。
