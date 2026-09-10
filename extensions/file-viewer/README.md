# File Viewer Extension

Folyn 的**通用文件查看器**扩展（fallback FileType extension）。负责 Folyn 没有专门实现的格式：

Office（docx / pptx / xlsx / pdf / ofd）、归档（zip / 7z / …）、邮件（eml / msg）、数据集、
CAD / 3D / 地理 / 思维导图 / 电子书 / 图像补充格式等。

> 本目录是一个**独立项目**，与 Folyn 主仓库代码解耦：只依赖 `folyn-plugin-sdk`
> （能力/契约类型）与 npm 上的 `@file-viewer/*` renderer 包，不 import 主应用内部模块。

## 结构

```
manifest.json      插件清单（id / tier / contributes.fileTypes）
src/index.tsx      插件入口（PluginModule：handlers + activate）
src/OfficeFileViewer.tsx   查看器组件
src/api.ts         activate 捕获的 ExtensionApi（用于 vault.readBinary 读字节）
src/react-shim.js  React 走宿主 window.React（避免双 React 实例）
src/shims/         少量 Node 内置模块的浏览器 shim（xmind-parser / ag-psd 的 Node-only 路径）
build.mjs          esbuild 打包为单文件自包含 ESM
```

## 设计要点

- **依赖本地化**：所有 `@file-viewer/renderer-*` 均通过 npm 安装并由 esbuild **内联**进
  `dist/index.js`，运行时**不访问任何 CDN**。
- **React 共享**：trusted 插件以 blob URL `import()` 进宿主 realm，无法解析 `import 'react'`；
  打包时把 `react` / `react/jsx-runtime` alias 到读取 `window.React` 的 shim，保证单实例。
- **文件读取走能力边界**：查看器通过 `api.vault.readBinary(filePath)` 取字节，不直接触碰 Tauri。
- **兜底优先级**：provider `priority: -1000`，专用 provider（用户安装的）会覆盖它。

## 构建与安装

```bash
pnpm install
pnpm build        # 产出 dist/（index.js + manifest.json）
```

然后在 Folyn → 设置 → 插件 → 从文件夹安装，选择 `extensions/file-viewer/dist/`。

## 说明

- 单文件 bundle 约 16MB（office renderer 引擎本身较大）。因为 blob-URL 模块无法做代码分割，
  所有 renderer 必须内联。若要按需加载，可后续改为 sandbox tier（独立 origin 支持分包）。
- CAD / media 的 WASM / 流式 renderer 暂未纳入（需要本地托管 WASM/worker 资源）。
