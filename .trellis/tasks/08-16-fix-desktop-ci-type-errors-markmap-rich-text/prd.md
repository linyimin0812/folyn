# Fix Desktop CI Type Errors (markmap + rich-text)

## 背景
GitHub Actions `pnpm build` 失败，本地因为 `apps/desktop/tsconfig.tsbuildinfo` 增量缓存跳过这些文件、看不出错。删掉 tsbuildinfo 后本地能复现同样的错误。

## 目标
让 `pnpm build`（`tsc -b && vite build`）在干净环境下零类型错误。

## 范围
仅 `apps/desktop` 下三处：
1. `src/components/file-types/mmap/resolveImages.ts`
   - `markmap-common` 不是本包直接依赖，pnpm 默认不 hoist → 去掉 `import type { IPureNode }`，改用本地最小结构类型（只用到 `.content` / `.children`）。
   - 第 27 行 replace 回调首参 `m` 未使用 → 删掉。
2. `src/components/file-types/rich-text/richTextExtensions.ts:83`
   - `onImagePaste` 不在 `Partial<ImageOptions>` 里。需要查 `RichTextImage` 扩展定义，确认 ImageOptions 增强写法或改用调用方闭包传参。
3. `src/components/file-types/rich-text/RichTextImage.tsx:599/645`
   - `ImageOptions.inline` 类型 `boolean`（非可选），本地扩展返回了 `boolean | undefined` → 显式给默认 `true` 或对齐类型。

## 验收
- 删除 `apps/desktop/tsconfig.tsbuildinfo` + `tsconfig.node.tsbuildinfo`
- 跑 `tsc -b` 干净通过（不跑 vite build，按用户偏好不跑全项目编译，只验证类型）
- 不改业务逻辑、不改运行时行为

## 非目标
- 不升级 markmap / tiptap 依赖
- 不重构 resolveImages / RichTextImage
