# Rich-text Migration Phase 3: Relocate

> Parent: [`09-11-migrate-rich-text-type-to-extension`](../09-11-migrate-rich-text-type-to-extension/prd.md)
> Depends on: [`09-11-rt-phase2-scaffold`](../09-11-rt-phase2-scaffold/prd.md) ✅ merged
> Phase 2 stub scaffold is in place; this phase swaps StubEditor for the real RichTextEditor + removes the builtin.

## Goal

把 `apps/desktop/src/components/file-types/rich-text/` 下 13 个源文件搬到 `extensions/rich-text/src/`，拷贝 `ImagePasteDialog` / `TableConvertDialog` / `imageUploader` / `richtextHtml` 到扩展包，把所有 host import (`@/store/...`, `@/utils/...`, `@tauri-apps/api/core`, `@/services/...`) 替换为 SDK API（`api.vault.*`, `api.storage`, `EditorProps.vaultRoot`/`signal`/`mode`）。Manifest 加回 `contributes.fileTypes`（覆盖 builtin），删 builtin rich-text handler dir + `@tiptap/*` desktop deps + `ContextMenu`/`FileIcon` 残留硬编码。

## Requirements

### 文件搬迁（13 src + 1 index）

从 `apps/desktop/src/components/file-types/rich-text/` 移动到 `extensions/rich-text/src/`：
- `RichTextEditor.tsx` / `RichTextImage.tsx` / `RichTextIndent.ts` / `RichTextMathModal.tsx`
- `RichTextSlashExtension.ts` / `RichTextSlashMenu.tsx` / `RichTextTableCell.ts`
- `RichTextToolbar.tsx` / `TableControlsOverlay.tsx` / `TableMenu.tsx` / `TableSizeGrid.tsx`
- `markdownTable.ts` / `markdownTablePaste.ts`
- `richTextContent.ts` / `richTextExtensions.ts`
- `index.ts` —— **删除**（扩展入口是 `src/index.tsx`，builtin handler 不再需要）

### 文件拷贝（dialogs / utils / exporters）

- `apps/desktop/src/components/editor/ImagePasteDialog.tsx` → `extensions/rich-text/src/dialogs/ImagePasteDialog.tsx`（**拷贝**，host 保留原版给其他类型用）
- `apps/desktop/src/components/editor/TableConvertDialog.tsx` → `extensions/rich-text/src/dialogs/TableConvertDialog.tsx`（**拷贝**，同上）
- `apps/desktop/src/utils/imageUploader.ts` → `extensions/rich-text/src/utils/imageUploader.ts`（**拷贝**，host `EditorPane.tsx` 仍在用）
- `apps/desktop/src/services/export/richtext.ts` → `extensions/rich-text/src/exporters/richtextHtml.ts`（**拷贝**，host `useExport.ts`/`vaultExport.ts` 仍在用）

### 测试搬迁

- `RichTextSlashExtension.test.ts` / `RichTextSlashMenu.test.ts` / `RichTextToolbar.test.ts`
- `markdownTable.test.ts` / `rich-text-handler.test.ts` / `rich-text-image.test.ts` / `rich-text-roundtrip.test.ts`
- `apps/desktop/src/services/export/richtext.test.ts` → `extensions/rich-text/src/exporters/richtextHtml.test.ts`

测试中 `@/...` import 改为相对路径。Vitest 配置：扩展包用 `vitest.config.ts`（workspace root 已有 vitest）。

### SDK 迁移（关键决策）

| 原 host import | 替换为 | 说明 |
|---|---|---|
| `useVaultStore.currentVault.basePath` | `EditorProps.vaultRoot` | Phase 1 已加到 EditorProps；shell 通过 WorkArea 注入 |
| `useEditorPrefsStore.tablePasteMode` | `api.storage.get('tablePasteMode')` + 本地 state | 默认 `'prompt'`；用 extension storage 替代 host pref store |
| `useEditorPrefsStore.setTablePasteMode` | `api.storage.set('tablePasteMode', v)` | |
| `convertFileSrc(fsPath)` | `api.vault.toAssetUrl(fsPath)` | Phase 1 已加 |
| `resolveBasePath(path)` | `api.vault.resolvePath(path)` | Phase 1 已加 |
| `isTauri()` | 删除 guard（扩展只在 Tauri 运行） | 或用 `api.env` 探测 |
| `@/services/clipboardFiles` `extractImgSrcFromHtml` | 拷贝函数到 `extensions/rich-text/src/utils/clipboardFiles.ts` | 小函数，直接拷 |
| `@/components/editor/ImagePasteDialog` | `../dialogs/ImagePasteDialog` | 已拷贝 |
| `@/components/editor/TableConvertDialog` | `../dialogs/TableConvertDialog` | 已拷贝 |
| `@/utils/imageUploader` | `../utils/imageUploader` | 已拷贝 |
| `@/utils/pathResolver` `resolveBasePath` | `api.vault.resolvePath` | |
| `../types` `EditorProps` | `folyn-extension-sdk` `EditorProps` | SDK 类型 |
| `'katex/dist/katex.min.css'` | 保留 import，esbuild 内联为 dataurl 或 vite 提取 | |

### Manifest 更新

`extensions/rich-text/src/manifest.json` 加回 `contributes.fileTypes` + 新增 `contributes.exporters`：

```json
"contributes": {
  "fileTypes": [
    {
      "id": "rich-text",
      "handler": "rich-text",
      "defaultViewMode": "edit",
      "supportedViewModes": ["edit"],
      "extensions": ["richtext"]
    }
  ],
  "fileTemplates": [ ... ],  // 已有
  "exporters": [
    {
      "id": "rich-text-html",
      "label": "Rich Text → HTML",
      "fileType": "rich-text",
      "run": "richtextHtml"
    }
  ]
}
```

### index.tsx 更新

替换 StubEditor 为真 RichTextEditor + 注册 exporter：

```tsx
import { RichTextEditor } from './RichTextEditor';
import { richTextToHtmlBlob } from './exporters/richtextHtml';

const provider: FileTypeProvider = {
  id: 'rich-text',
  extensions: ['richtext'],
  needsFileContent: true,
  defaultMode: 'edit',
  modes: [{ id: 'edit', kind: 'component', component: RichTextEditor }],
};

const module: ExtensionModule = {
  handlers: { 'rich-text': provider },
  exporters: [{ id: 'rich-text-html', run: async (ctx) => ({ blob: await richTextToHtmlBlob(ctx.content), ext: 'html' }) }],
  activate(api, ctx) { setApi(api); setExtensionId(ctx.extensionId); },
};
```

### 扩展包构建配置

Phase 2 省略的 vite/tailwind/postcss 在 Phase 3 加回：
- `vite.config.ts` — 不需要 iframe bundle（rich-text 全在 host realm）。**省略**。
- `tailwind.config.js` + `postcss.config.js` —— RichTextEditor 用了 Tailwind 类（如 `p-4`, `text-t2`）。**加回**：扫描 `src/**/*.{ts,tsx}`，postcss 处理。但 host 的 `tailwind.config.js` 已经扫描了 host 类，扩展的 tailwind 输出会**重复** host 已有的类。**简化**：扩展只 ship 额外需要的类（rich-text 特有），不重复 host CSS。实际上更简单：rich-text 扩展的组件类（`btn`, `toolbar` 等）如果都来自 host 全局 CSS，扩展不需要自己的 tailwind —— 测试一下，可能可以省略。
- `build.mjs` — 调整 esbuild 配置：加 `katex.min.css` 作为可加载资源，或让 esbuild 把 CSS inline 成 dataurl。

**Phase 3 决策**：先不加 tailwind/postcss。如果 RichTextEditor 渲染时发现样式缺失（host CSS 没覆盖 rich-text 特有类），再加。先试，再补。

### Host 清理

- 删除 `apps/desktop/src/components/file-types/rich-text/` 整个目录（13 src + index.ts + tests）
- 从 `apps/desktop/package.json` 删除 `@tiptap/*` 全部依赖（14 个包）
- `apps/desktop/src/services/export/richtext.ts` —— **保留**（host `useExport.ts` / `vaultExport.ts` 仍在用）。Phase 4 或后续清理 task 再迁移。
- `apps/desktop/src/components/icons/FileIcon.tsx` —— 已有的 `dbml: 'sql'` 删除是**遗留改动**，不属于本 task。`richtext: 'richtext'` 和 `'rich-text': 'richtext'` 行 —— **删除**（builtin handler 已删，这些 lookup 没用了）
- `apps/desktop/src/components/sidebar/ContextMenu.tsx` —— Phase 2 已删 `NEW_FILE_GROUPS` 的 `'rich-text'`。Phase 3 检查 `fileTypeLabelKeys['rich-text']` 是否还有用：扩展接管后 handler 来自扩展，label 由扩展 manifest 提供，硬编码 `fileTypeLabelKeys['rich-text']` 可以删（或留作 fallback，无害）。
- `apps/desktop/src/components/file-types/registry.ts` 的 `import.meta.glob` —— rich-text handler 删了 dir，glob 自动不匹配。**无需改 registry**（glob 扫描空目录无副作用）。

### pnpm-workspace

无需改（`extensions/*` 已在）。

## Acceptance Criteria

- [ ] `extensions/rich-text/src/` 包含 13 个搬来的 src 文件 + 4 个拷贝文件（dialogs × 2, utils, exporters）
- [ ] 所有 `@/...` host import 替换为 SDK API 或相对路径
- [ ] `extensions/rich-text/src/index.tsx` 导出 RichTextEditor + exporter，StubEditor 删除
- [ ] Manifest 声明 `contributes.fileTypes` + `contributes.fileTemplates` + `contributes.exporters`
- [ ] `pnpm --filter @folyn/extension-rich-text build` 产出 `dist/index.js` + `dist/manifest.json`
- [ ] `pnpm --filter @folyn/extension-rich-text typecheck` 通过
- [ ] `apps/desktop/src/components/file-types/rich-text/` 目录删除
- [ ] `apps/desktop/package.json` 不再含 `@tiptap/*` 依赖
- [ ] `apps/desktop/src/components/icons/FileIcon.tsx` 删除 `richtext` / `'rich-text'` 两行
- [ ] `pnpm install` 成功（lockfile 更新）
- [ ] desktop typecheck 通过（无 dangling import 报错）
- [ ] desktop 测试通过（删除 rich-text 的 7 个 test 文件后，剩余测试无 fail）
- [ ] 扩展测试通过：`pnpm --filter @folyn/extension-rich-text test`（如加 vitest 配置）

## Definition of Done

- lint / typecheck / build green
- 桌面 app 启动后安装 `extensions/rich-text/dist/` → 打开 `.richtext` 文件 → RichTextEditor 渲染 + 可编辑 + 图片粘贴 + 表格 + 数学公式 + slash 菜单 + 工具栏
- 命令面板 "New Rich Text" 创建空 doc JSON 文件
- 导出菜单出现 "Rich Text → HTML"（扩展注册的 exporter）
- dbml 扩展回归通过

## Out of Scope

- 端到端验证 + 回归修复（Phase 4 / `09-11-rt-phase2-verify`）
- 把 `services/export/richtext.ts` 从 host 移除（host 仍用，Phase 4+ 清理）
- 把 `utils/imageUploader.ts` 从 host 移除（EditorPane 仍用）
- 把 `ImagePasteDialog` / `TableConvertDialog` 从 host 移除（其他类型可能用，需先确认）
- 性能优化（bundle size, code-split）

## Technical Notes

### 关键 SDK API（Phase 1 已 ship）

- `api.vault.toAssetUrl(fsPath)` — Tauri `convertFileSrc` 包装
- `api.vault.resolvePath(path)` — `~`/`$HOME` 展开
- `api.storage.get(key)` / `set(key, value)` — per-extension namespaced storage
- `api.vaultConfig.getImagePath()` — 图片保存路径
- `EditorProps.vaultRoot` / `mode` / `readonly` / `signal` — Phase 1 已加

### 风险点

1. **Tailwind 类缺失**：扩展包不 build Tailwind，依赖 host 全局 CSS。如果 RichTextEditor 用了 host 没扫描到的类（如 `prose` 等），样式会丢。**缓解**：先试，发现缺失再加 tailwind config 到扩展。
2. **tiptap CSS（katex.min.css）**：esbuild 默认不处理 CSS。**缓解**：esbuild `loader: { '.css': 'text' }` 把 CSS inline 为字符串，运行时 `injectStyles`。或者 vite bundle 处理。
3. **EditorProps signal**：Phase 2 用 `neverAborts`。Phase 3 不需要改（rich-text 没用到 signal）。但 SDK API 需要它存在。
4. **useEditorPrefsStore 替换**：`tablePasteMode` 用户偏好。SDK `storage` 是 async，原 store 是 sync Zustand。**缓解**：用 `useEffect` 异步加载 + 本地 state 镜像，避免阻塞 render。

### 实施顺序建议（trellis-implement 参考）

1. 拷贝 dialogs/utils/exporters 到扩展（不删 host 原版）
2. 移动 13 个 src 文件到扩展
3. 逐文件替换 `@/...` import 为 SDK API（RichTextEditor 是核心，先做；其他依赖它）
4. 更新 `index.tsx`：删 StubEditor，导出 RichTextEditor + exporter
5. 更新 `manifest.json`：加 `contributes.fileTypes` + `contributes.exporters`
6. 加 `vitest.config.ts` + 搬测试 + 改测试 import
7. 调整 `build.mjs`：加 CSS loader（如需）
8. 删 `apps/desktop/src/components/file-types/rich-text/`
9. 删 `@tiptap/*` from `apps/desktop/package.json` + `pnpm install`
10. 删 `FileIcon.tsx` 的 rich-text 硬编码
11. typecheck + test + build green

### 关键参考文件

- `extensions/dbml/src/index.tsx` — 入口模式
- `extensions/dbml/src/api.ts` — setApi/getApi
- `apps/desktop/src/components/work-area/WorkArea.tsx:260` — InlineEditor 注入 vaultRoot/mode/readonly/signal
- `apps/desktop/src/services/extension-host/createExtensionApi.ts` — SDK 实现
- `packages/extension-sdk/src/presentation.ts` — EditorProps 定义
- `apps/desktop/src/components/file-types/rich-text/RichTextEditor.tsx` — 主组件（搬迁源）
