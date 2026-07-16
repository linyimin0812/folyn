# 支持额外的文件预览格式（preset-all）

## Goal

当前项目用 `@file-viewer/preset-office`，只覆盖 Office 类 21 个扩展名。文档（https://doc.file-viewer.app/zh/guide/formats）描述 `@file-viewer/preset-all` 覆盖 206 扩展名 / 24 链路。本任务把 preset 切换到 `preset-all`，把当前未由自定义 handler 覆盖的扩展名登记到 office handler 的 `extensions` 数组，解锁压缩包/邮件/CAD/3D/地理/Typst/XMind/EPUB/音视频/字体/PSD/数据等格式。

## What I already know

- 注册中心：`apps/desktop/src/components/file-types/registry.ts`（`import.meta.glob` 自动发现 `./*/index.{ts,tsx}`）
- Office handler：`apps/desktop/src/components/file-types/office/index.ts` — 当前 `extensions` 21 项
- 视图组件：`apps/desktop/src/components/file-types/office/OfficeFileViewer.tsx` — 引入 `officePreset from '@file-viewer/preset-office'`
- CSV preview 也用 `officePreset`：`apps/desktop/src/components/file-types/csv/CsvFileViewerPreview.tsx`
- Vite 配置：`apps/desktop/vite.config.ts:11` — `fileViewerRenderers({ preset: 'office', copyAssets: true })`
- 资产清单：`apps/desktop/public/flyfish-viewer-assets.json`（由 vite-plugin 生成）
- 已安装包：`@file-viewer/react ^2.1.17`、`@file-viewer/preset-office ^2.1.17`、`@file-viewer/vite-plugin ^2.1.17`
- 自定义 handler（保留不动）：markdown(md/mdx/markdown)、json、csv、html(htm)、image(png/jpg/jpeg/gif/webp/svg/bmp/ico)、drawio(drawio/dio)、excalidraw、mmap、dbml、code（fallback，可编辑文本）

## Requirements

- 把 `@file-viewer/preset-office` 替换为 `@file-viewer/preset-all`（package.json + lockfile）
- `vite.config.ts` 的 `fileViewerRenderers({ preset: 'all', copyAssets: true })`
- `OfficeFileViewer.tsx` 与 `CsvFileViewerPreview.tsx` 的 import 改成 `preset-all`
- `office/index.ts` 的 `extensions` 数组补充所有缺失扩展名
- 保留现有自定义 handler，不回退能力
- 构建后 WASM/字体/vendor 等静态资源随 `copyAssets: true` 自动复制到 `public/`

## Acceptance Criteria

- [ ] `pnpm install` 后 `preset-office` 不再出现在 `apps/desktop/package.json`
- [ ] `pnpm build` 在 `apps/desktop` 成功，`flyfish-viewer-assets.json` 列出新 renderer 资产
- [ ] 至少手测：zip / eml / dwg / glb / geojson / typ / xmind / epub / mp4 / tiff / psd 各能打开预览
- [ ] 现有 Office 文档（docx/xlsx/pptx/pdf）预览无回退
- [ ] 自定义 handler（md/json/csv/html/image/drawio/excalidraw/mmap/dbml）行为不变

## Definition of Done

- 类型检查 / lint / 构建通过
- 手测覆盖新增类别各一种样本
- `flyfish-viewer-assets.json` 已重新生成
- 若静态资源体积显著增长，在 PR 描述中标注

## Decision (ADR-lite)

**Context**: preset-all 覆盖 24 条链路，其中部分链路（txt/json/xml/yml/log/ipynb/patch 等）当前由 `code` fallback handler 用 CodeMirror 承接，可编辑。
**Decision**: 只把"不可作为纯文本编辑"的格式登记到 office handler（压缩包/邮件/CAD/3D/地理/Typst/XMind/EPUB/UMD/绘图(mmd/plantuml)/音视频/字体/PSD/数据/更多图片/Office 模板）。文本类扩展名继续走 code fallback，保留编辑能力。
**Consequences**: 用户不会失去 .txt/.xml/.yml 等的编辑能力；preset-all 的 highlight.js 链路对这些格式不生效（可接受，因为 code fallback 更强）。

## 新增扩展名清单（追加到 office handler）

- **Word/Excel 模板**：docm, dotx, dotm, xltx, xlt, xltm
- **Typst**：typ, typst
- **压缩包**：zip, zipx, 7z, rar, tar, gz, gzip, tgz, bz2, bzip2, tbz, tbz2, xz, txz, lzma, zst, cab, ar, cpio, iso, xar, lha, lzh, jar, war, ear, apk, cbz, cbr
- **邮件**：eml, msg, mbox
- **EDA**：olb, dra, gds, oas, oasis
- **CAD**：dwg, dxf, dwf, dwfx, xps
- **地理**：geojson, kml, gpx, shp
- **3D**：glb, gltf, obj, stl, ply, fbx, dae, 3ds, 3mf, amf, usd, usda, usdc, usdz, kmz, pcd, wrl, vrml, xyz, vtk, vtp, step, stp, iges, igs, ifc, 3dm
- **XMind**：xmind
- **绘图（只读）**：mmd, plantuml, puml
- **电子书**：epub, umd
- **图片（补充）**：tiff, tif, avif, heic, heif, jxl
- **音频**：mp3, mpeg, wav, ogg, oga, opus, m4a, aac, flac, weba, midi, mid
- **视频**：mp4, webm, m3u8
- **字体/设计/数据**：ttf, otf, woff, woff2, psd, ai, eps, sqlite, wasm, parquet, avro, webarchive

## Out of Scope

- 不动现有自定义 handler 的实现
- 不接入 preset-all 之外的第三方 viewer
- 不做格式白名单 UI / 配置开关
- 不改 office handler 的 id（仍为 `office`，避免破坏 registry 状态）

## Technical Notes

- `copyAssets: true` 会让 vite-plugin 把 preset-all 涉及的 WASM/字体/vendor 资产复制到 `public/`，体积会显著增长（CAD/OFD/Typst/3D/EDA 各带 WASM）
- preset-all 内部按需异步加载，未命中的格式不会进首屏 bundle
- `office` handler 当前 `needsFileContent: false, useCodeMirror: false, supportedViewModes: ['preview']`，新增格式同样走只读预览路径
- `code` fallback 仍会兜底所有未登记的文本类扩展名（.ts/.py/.yml 等），保持可编辑
