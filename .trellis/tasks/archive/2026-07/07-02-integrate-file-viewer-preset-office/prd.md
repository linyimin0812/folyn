# integrate file-viewer preset-office

## Goal

全量接入 `@file-viewer` 的 `preset-office`，让 Folyn 离线预览 Word/Excel(含 csv)/PowerPoint/OFD 等 Office 文档；放弃 Folyn 自建 CSV 预览，CSV 改由 file-viewer 的 spreadsheet renderer 承接。PDF 保留 Folyn 现有 PdfViewer。

## What I already know

- `@file-viewer/react`（React 18/19 原生组件）+ `@file-viewer/preset-office`（PDF/Word/Excel/PPT/OFD/RTF/OD）+ `@file-viewer/vite-plugin`（Vite 自动发现 preset + 复制 Worker/WASM/字体资产）。Apache-2.0。
- API：`<FileViewer file={File} url={string} options={{preset}} />`，`file` 推荐包装成带扩展名的 `File`。
- 离线：Worker/WASM/字体自托管，`copyAssets:true` 复制；非 Vite 用 `options.preset`，Vite 用插件自动发现。
- Folyn file-type registry：`import.meta.glob('./*/index.ts')` 自动加载 handler；`PreviewProps = {content, filePath, vaultRoot}`；`needsFileContent:false` 模式已有（pdf/image）。
- Tauri FS：`@tauri-apps/plugin-fs.readFile(path): Promise<Uint8Array>`（二进制）。`vaultRoot` + `filePath` 拼绝对路径。
- vite.config.ts：`base: isTauri ? '/' : '/folyn'`，Tauri 用 `/`。CSP `null`（不挡 worker/WASM）。
- csv 自建产物仅 csv handler 自用：`components/file-types/csv/{index.ts,CsvTablePreview.tsx,CsvTablePreview.test.tsx}` + `utils/csvParse.ts` + `utils/csvParse.test.ts`。`csv` icon 映射（FileIcon 两表）保留（.csv 文件树图标）。

## Requirements

- 装包：`@file-viewer/react`、`@file-viewer/preset-office`；dev 依赖 `@file-viewer/vite-plugin`。
- `vite.config.ts`：加 `fileViewerRenderers({ copyAssets: true })` 插件。
- 新 handler `components/file-types/office/index.ts`：`id:'office'`，`extensions:['docx','doc','dot','rtf','odt','xlsx','xls','xlsm','xlsb','csv','ods','fods','numbers','pptx','pptm','potx','potm','ppsx','ppsm','odp','ofd']`，`needsFileContent:false`，`useCodeMirror:false`，`supportedViewModes:['preview']`，`Preview: OfficeFileViewer`。
- 新组件 `components/file-types/office/OfficeFileViewer.tsx`：用 `filePath`+`vaultRoot` 经 `@tauri-apps/plugin-fs.readFile` 读字节 → `new File([bytes], fileName)` → `<FileViewer file={file} options={{preset: officePreset}} />`（或依赖 vite-plugin 自动发现）。容器 `h-full w-full`，加载/错误态。
- 移除 csv 自建：删 `components/file-types/csv/`、`utils/csvParse.ts`、`utils/csvParse.test.ts`。FileIcon 的 `csv` icon 映射保留。
- PDF handler 不动；markdown/code/image/web/clip/excalidraw/html 不动。
- tsc + vitest 绿；`vite build` 成功（验证插件 + 资产复制在构建期可用）。

## Acceptance Criteria

- [ ] `.docx/.xlsx/.pptx/.csv/.ofd` 等扩展名注册到 office handler。
- [ ] office handler `needsFileContent:false`，Preview 读二进制构 File 交 FileViewer。
- [ ] csv 自建代码删除（csvParse/CsvTablePreview/csv handler/测试）。
- [ ] csv 文件树图标仍显示（FileIcon csv 映射保留）。
- [ ] tsc + vitest 绿。
- [ ] `vite build` 成功，file-viewer 资产被复制。
- [ ] （运行时验证，需手动跑 app）在 Tauri 里打开 docx/xlsx/pptx/csv 能渲染；若 Worker/WASM URL 解析失败，按 `options.docx.workerUrl` 等配置自托管地址。

## Definition of Done

- tsc / vitest / vite build 绿。
- 遵循 desktop frontend spec。
- 运行时 Tauri 资产加载若需额外配置，记录在 PRD/任务并提示用户验证。

## Technical Approach

- 依赖：`pnpm add @file-viewer/react @file-viewer/preset-office` + `pnpm add -D @file-viewer/vite-plugin`（在 apps/desktop）。
- vite.config.ts：`plugins: [react(), fileViewerRenderers({ copyAssets: true })]`。
- `OfficeFileViewer.tsx`：`useEffect` 依 `filePath` 读字节；`const abs = vaultRoot.replace(/\/+$/,'') + '/' + filePath.replace(/^\/+/,'')`；`const bytes = await readFile(abs)`；`const name = filePath.split('/').pop() || 'file'`；`const file = new File([bytes], name)`；state: loading/error/`<FileViewer file={file} />`。容器 `h-full w-full overflow-hidden`。FileViewer 的 `style={{height:'100%'}}`。
- office handler 一个 Preview 承接所有 office 扩展名（FileViewer 按 file 扩展名自选 renderer）。
- 删 csv 旧代码；registry 自动不再加载 csv handler。

## Out of Scope

- 不接 preset-engineering（CAD/3D/绘图等）——仅 preset-office。
- 不动 PDF handler。
- 不加 docx/xlsx/pptx 专用文件图标（用 DefaultFileIcon）。
- 不做 Office 编辑（只读预览）。
- 不做运行时 Tauri 深度验证（构建期 + tsc + 测试为准；运行时需用户跑 app 确认，若 Worker URL 失败再补 `options.*.workerUrl` 配置）。

## Technical Notes

- 受影响：`apps/desktop/package.json`、`vite.config.ts`、新增 `components/file-types/office/`、删除 `components/file-types/csv/` + `utils/csvParse*`。
- 风险：Tauri webview 的 Worker/WASM 资产 URL 解析（vite-plugin 复制到 dist，base `/`）；若失败用 `options.docx.workerUrl`/`pdf.workerUrl`/`spreadsheet.workerUrl` 指向自托管地址。
