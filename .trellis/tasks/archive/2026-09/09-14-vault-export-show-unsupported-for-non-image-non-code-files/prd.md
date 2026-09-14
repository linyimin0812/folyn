# Vault 导出:为非图片的未支持文件类型显示"不支持此文件类型"页

## Goal

Vault 整库导出 HTML 时,目前的行为是:
- 图片类型(svg/png/jpeg/gif/webp/bmp/ico + 二进制图片格式 tiff/heic/psd/…)被静默过滤,不导出。
- 二进制 office 文档、未安装扩展的 .dbml/.richtext 等(ft='unsupported')也被静默过滤。
- 未识别的文本扩展名(.txt/.log/.py…)回退为 `code`,导出为代码块。

用户希望:除图片类型仍整体排除外,**所有其他文件类型都要导出**;对 `ft='unsupported'` 的文件,在导出页面中显示"不支持此文件类型"提示页(而非静默丢弃);`code` 类型保持现有导出逻辑不变。

## What I already know

- `apps/desktop/src/store/editorStore.ts:18` `detectFileType(filePath)`:返回 'markdown'/'code'/'unsupported'/具体 handler id 等。
- `apps/desktop/src/components/file-types/binaryExtensions.ts`:已有 `BINARY_EXTENSIONS` / `EXTENSION_REQUIRED_EXTENSIONS` / `isBinaryExtension` / `isExtensionRequired`。
- 图片 handler `image` 覆盖:`png/jpg/jpeg/gif/webp/bmp/ico`(`needsFileContent=false`,apps/desktop/src/components/file-types/image/index.ts)。
- SVG handler `svg` 覆盖:`svg`(`needsFileContent=true`,apps/desktop/src/components/file-types/svg/index.ts)。
- 二进制图片扩展在 `BINARY_EXTENSIONS` 中:`tiff/tif/avif/heic/heif/jxl/psd/ai/eps`。
- `apps/desktop/src/services/export/vaultExport.ts:82` `filterTextTree`:当前规则 `ft !== 'svg' && (!handler || handler.needsFileContent !== false)` 才保留,否则过滤。
- `apps/desktop/src/services/export/vaultExport.ts:169` `fileToBodyFragment`:按 fileType 分支生成 HTML;无 'unsupported' 分支,落到末尾的 code 块。
- `apps/desktop/src/services/export/vaultExport.ts:597` `countFilteredFiles`:统计被过滤的"二进制"文件数,用于导出成功提示。
- `apps/desktop/src/services/export/vaultExport.ts:350` `VAULT_EXPORT_STYLES`:单文件模式合并样式表;folder 模式 standalone HTML 内联样式(canvas/svg/html 分支各自内联)。
- i18n 文案:`apps/desktop/src/i18n/locales/{en,zh,ja,de,fr,es}/editor.json` 中 `vault.success` / `vault.hint` 文案描述为"过滤二进制文件"。

## Requirements

- 仅图片类型(svg/png/jpeg/gif/webp/bmp/ico/tiff/tif/avif/heic/heif/jxl/psd/ai/eps)在 vault 导出时整体排除。
- `ft='code'` 文件保持现有 code-block 导出逻辑。
- `ft='unsupported'`(包括二进制 office 文档、未安装扩展的 .dbml/.richtext/二进制图片格式以外的类型)在导出中渲染为"不支持此文件类型"静态页面,不再静默过滤。
- 其他已有 handler 的类型(markdown/json/csv/html/canvas types)逻辑不变。
- 导出成功提示与 hint 文案反映"过滤图片"而非"过滤二进制"。
- Folder 模式的 standalone HTML 也要正确渲染"不支持"页。

## Acceptance Criteria

- [ ] 含 .xlsx/.docx 的 vault 导出后,这些文件出现在左侧树并显示"不支持此文件类型"页。
- [ ] 含 .png/.svg/.heic 的 vault 导出后,这些文件不在树中,filteredCount 计入它们。
- [ ] 含 .txt/.py 的 vault 导出后,正常以 code 块渲染。
- [ ] 含 .dbml(未装扩展)的 vault 导出后,显示"不支持此文件类型"页。
- [ ] 单文件 / folder 两种模式都生效。
- [ ] 导出成功提示文案改为"过滤 N 个图片文件",6 个 locale 全部更新。
- [ ] `pnpm typecheck` / `pnpm lint` 通过。

## Definition of Done

- 单元测试覆盖 `filterTextTree` / `countFilteredFiles` 的图片分类规则(可选,目前没有此文件的测试,ponytail 起见补一个最小测试)。
- 6 个 locale 的 editor.json 文案更新。
- typecheck / lint 绿。

## Out of Scope

- 不修改 `editorStore.ts:detectFileType` 行为(打开预览时的分类不变)。
- 不为二进制图片格式扩展 image handler(避免尝试在 ImageViewer 里渲染 .psd/.tiff)。
- 不引入 i18n 到导出 HTML 文本中("不支持此文件类型"使用硬编码中文,与现有 export HTML lang="zh-CN" 一致)。
- 不处理"handler 存在但 needsFileContent=false 且非图片"的扩展自定义场景(当前没有这种 builtin handler)。

## Technical Approach

1. `binaryExtensions.ts`:新增 `IMAGE_EXTENSIONS` set + `isImageExtension(ext)` helper。set 内容 = image handler 的扩展名 + svg + BINARY_EXTENSIONS 中的图片项。
2. `vaultExport.ts:filterTextTree` 改为:`if (!isImageExtension(ext)) out.push({ ...e })`。
3. `vaultExport.ts:countFilteredFiles` 改为:仅统计 `isImageExtension(ext)` 的文件。
4. `vaultExport.ts:fileToBodyFragment` 在 html 分支之后、code 分支之前加 `if (file.fileType === 'unsupported')` 分支,返回静态 "不支持此文件类型" HTML + 内联 CSS。
5. `VAULT_EXPORT_STYLES` 末尾追加 `.vt-unsupported` 样式(单文件模式必需)。
6. i18n: 6 个 locale 的 `editor.json` 中 `vault.success` 与 `vault.hint` 文案改为反映"图片"。

## Technical Notes

- 图片扩展集合的真理源:image handler index.ts + svg handler index.ts + BINARY_EXTENSIONS 中图片子集。集中到 `binaryExtensions.ts` 的 `IMAGE_EXTENSIONS` 一处,避免散落。
- folder 模式 standalone HTML:沿用 canvas/html 分支的内联 CSS 模式。
- 导出 HTML 没有现成 i18n 通道,所有现有文案都是硬编码英文/中文混合;"不支持此文件类型"硬编码中文与 `lang="zh-CN"` 一致。
