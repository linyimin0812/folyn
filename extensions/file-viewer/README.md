# File Viewer Extension

Folyn 的**通用文件查看器**扩展（兜底 FileType extension）。负责 Folyn 没有专门实现的格式：

Office（docx / pptx / xlsx / pdf / ofd）、CAD（dwg / dxf / …）、归档、邮件、数据集、
3D / 地理 / 思维导图 / 电子书 / 媒体 / 图像补充格式等。

> 独立项目，与 Folyn 主仓库解耦：只依赖 `folyn-plugin-sdk`（契约类型）与 npm 上的
> `@file-viewer/*` renderer 包，不 import 主应用内部模块。

## 架构：宿主 iframe 包装 + 插件 origin 渲染

```
宿主 realm (trusted, blob-URL)
  └─ OfficeFrame (4KB 包装)  ── api.vault.readBinary 读字节 ──┐
        │ postMessage {bytes, name, theme}                    │
        ▼                                                    │
folyn-plugin://localhost/<id>/preview.html  ◄────────────────┘
  └─ @file-viewer renderers 在真实 origin 里运行
       → Web Worker / WASM / 代码分割 / 相对资源 全部可用
```

**为什么这样拆**：trusted 插件以 blob-URL 模块 `import()` 进主 realm，blob 模块里
`new Worker(new URL('./worker.js', import.meta.url))` / WASM 相对路径**无法解析**，所以
pptx / xlsx / pdf / dwg 这类依赖 worker/WASM 的 renderer 跑不了。把 renderer 放进插件
自己的 `folyn-plugin://` iframe（真实 origin）即可全部支持——而且**重代码不进宿主包**
（宿主 bundle 仅 ~4KB）。

## 结构

```
src/manifest.json  插件清单（id / tier / contributes.fileTypes[] 按文件族拆分 / vault.readBinary）
src/index.tsx      宿主入口（按族注册 provider，每个带自己的 icon；activate 捕获 api/extensionId）
src/icons.tsx      各文件族的内联 SVG 图标（doc/ppt/xls/pdf/zip/…）— 不依赖应用资源
src/OfficeFrame.tsx  宿主 iframe 包装（读字节 → postMessage → iframe）
src/preview.html   iframe 的 HTML 入口（vite 构建进 dist/）
src/preview.tsx    iframe 入口（收到字节 → FileViewer）
src/react-shim.js  宿主 bundle 的 React 走 window.React（单实例）
src/shims/         少量 Node 内置模块浏览器 shim
build.mjs          宿主 bundle（esbuild）+ iframe bundle（vite）
vite.config.ts     iframe bundle 配置（root=src/，worker/WASM/代码分割，base './'）
```

> 图标也迁到了插件：每种文件族一个 provider、各自带内联 SVG 图标；应用不再内置这些
> 类型的主题图标（详见 `apps/desktop/.../FileIcon.tsx` 的 `EXT_TO_THEME_ICON`）。

> 源码 `manifest.json` **故意放在 `src/`**：这样扩展根目录没有 `manifest.json`，
> 在「从文件夹安装」里误选根目录会直接报 `source_path must contain manifest.json`，
> 而不是静默加载未构建的资源。**必须选 `dist/`。**

## 构建与安装

```bash
pnpm install
pnpm build        # 产出 dist/（index.js + preview.html + assets/ + wasm/ + vendor/ + manifest.json）
```

在 Folyn → 设置 → 插件 → 从文件夹安装，选择 **`extensions/file-viewer/dist/`**（不是扩展根目录）。

## 依赖

- renderer 全部通过 npm 安装并由构建**内联/分包**到 `dist/`，运行时**不访问 CDN**。
- iframe 由宿主以 `sandbox="allow-scripts allow-same-origin"` 嵌入（插件自己的 origin，
  无法访问主应用 DOM）。
- 宿主 CSP（`PLUGIN_CSP`）已放宽 `worker-src` / `style-src` / `img-src` / `font-src` /
  `connect-src` / `media-src`，以允许插件 origin 下的 worker / WASM / 资源。
