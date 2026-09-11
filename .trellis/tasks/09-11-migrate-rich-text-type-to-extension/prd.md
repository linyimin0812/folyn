# 富文本类型迁移到扩展实现

## Goal

将当前内置在 `apps/desktop/src/components/file-types/rich-text/` 的 `.richtext` 文件类型（tiptap WYSIWYG 编辑器），迁移为 `extensions/rich-text/` 下的独立 trusted 扩展包 `@folyn/extension-rich-text`，通过 `folyn-extension-sdk` 的 `ExtensionModule`/`FileTypeProvider` 注册。迁移后 desktop app 不再内置该类型，由扩展提供，且扩展代码不依赖任何宿主 `@/...` 内部模块（严格 SDK 边界）。

## What I already know

### 当前现状（rich-text 内置）
- 入口：`apps/desktop/src/components/file-types/rich-text/index.ts`，handler id `rich-text`，扩展名 `richtext`
- 已是 `FileTypeProvider` 形态：`modes: [{ id: 'edit', kind: 'component', component: RichTextEditor }]`
- 通过 `apps/desktop/src/components/file-types/registry.ts` 的 `import.meta.glob` 在构建时注册
- 文件清单（13 个）：
  - `RichTextEditor.tsx`、`RichTextToolbar.tsx`、`RichTextSlashMenu.tsx`、`RichTextSlashExtension.ts`、`RichTextImage.tsx`、`RichTextMathModal.tsx`、`TableControlsOverlay.tsx`、`TableMenu.tsx`、`markdownTablePaste.ts`、`markdownTable.ts`、`richTextExtensions.ts`、`richTextContent.ts`、`index.ts`
- 测试：`rich-text-handler.test.ts`、`RichTextSlashMenu.test.ts`
- 磁盘格式：tiptap 原生 JSON
- 已有 anti-write-back-loop（`loadedContentRef` + `saveTimerRef` + `shouldApplyExternalContent` + `stableStringify`）

### 当前 RichTextEditor 直接依赖的宿主内部
1. `useVaultStore`（Zustand）：`currentVault.basePath`（图片路径解析）
2. `useVaultConfigStore.imagePath`：图片上传目录（默认 `assets/images/`）
3. `convertFileSrc`（Tauri plugin，via `@/utils/imageUploader`）：fs path → `asset://` URL
4. `resolveBasePath`（`@/utils/pathResolver`）：`~`/`$HOME` 解析
5. `getStrategy`/`fileToBase64`/`convertImageFormat`（`@/utils/imageUploader`）：图片处理
6. `useEditorPrefsStore.tablePasteMode`：跨编辑器设置
7. `ImagePasteDialog`（`@/components/editor/ImagePasteDialog.tsx`）：与 markdown 共享
8. `TableConvertDialog`（`@/components/editor/TableConvertDialog.tsx`）：与 markdown 共享
9. `services/export/richtext.ts`：HTML 导出器（用 `getRichTextExtensions` 渲染）
10. `getFileTypeIcon('rich-text')`（`@/components/icons/FileIcon`）：文件图标

### 已确认不需要改的（重要）
- ✅ **Topbar 不用改**：`Topbar.tsx:111` `showViewMode = modes.length > 1`。Rich-text 只有 `edit` 模式，toggle 自动隐藏。spec 里写的 `HIDE_VIEW_MODE_FILE_TYPES` 已不存在。
- ✅ **新建文件入口不用额外机制**：`ContextMenu.tsx:99-115` 已有动态扫描 `getAllHandlers()` 的机制，扩展注册的 handler 自动进入 `extras` 组。只要从 `NEW_FILE_GROUPS`（line 47）和 `fileTypeLabelKeys`（line 42）删除 `'rich-text'` 即可。
- ✅ **`FileTemplateContribution` 已存在**：`packages/extension-sdk/src/types.ts:328` + adapter `apps/desktop/src/services/extension-host/fileTemplateAdapter.ts`。manifest 声明 `contributes.fileTemplates` 即可，命令面板会出现 "New Rich Text"。**不需要 `ExtensionModule.templates` 字段**。
- ✅ **AI apply 路由不用动**：`aiStore.addFileChange` 按 `useCodeMirror` 分流，扩展组件通过 `kind: 'component'` 走 `updateTabContent` 分支，自动生效。
- ✅ **anti-loop 不缺 SDK 能力**：`WorkArea.tsx:260` 把 `externalContentVersion` 烧进 `key`，remount 路径已处理；in-place 路径（AI reject-revert）只需 `content` prop + `loadedContentRef` 模式即可识别。
- ✅ **`ExtensionModule.exporters` 已存在**：HTML 导出器可走 `contributes.exporters` + `ExtensionModule.exporters`。

### SDK 真缺口（仅 2 处）
1. `VaultApi` 加 `toAssetUrl(fsPath: string): string`（包装 `convertFileSrc`，Tauri-only；非 Tauri 原样返回）+ `resolvePath(relPath: string): Promise<string>`（包装 `resolveBasePath`，`~`/`$HOME` 解析）
2. 新 `VaultConfigApi`（或并入 VaultApi）：`getImagePath(): string`（读 `useVaultConfigStore.imagePath`）

### Host 渲染缺口（仅 1 处）
- `WorkArea.tsx:256-268`：渲染 inline `kind: 'component'` 时只传 `content/tabId/filePath/onChange/onSave`（legacy EditorProps），没传 `vaultRoot/mode/readonly/signal`。需要补齐以对齐 SDK 的 `FilePresentationContext`。

## Decision (ADR-lite)

**Context**: 当前 rich-text 是 builtin handler，直接 import 宿主内部。迁移到扩展需要先补齐 SDK 能力缺口，再做严格边界搬迁，避免遗留 host-import 技术债。

**Decision**: 走「先扩 SDK 再搬迁」+ 共享 UI 组件「拷贝到扩展」。
- Phase 1：SDK 加 2 个能力（VaultApi 扩展 + VaultConfigApi）+ WorkArea 传 `vaultRoot` 等到 inline component
- Phase 2：建 `extensions/rich-text/`，搬代码，host import 全换 SDK API，移除 builtin 注册，移除 `@tiptap/*`，更新 spec
- `ImagePasteDialog`/`TableConvertDialog`/`imageUploader utility`/`tablePasteMode` 全部拷贝到扩展，markdown 那侧不动。代码重复作为已知债，未来若第三个编辑器扩展有同样需求再抽 `@folyn/editor-shared`。

**Consequences**: 
- Pros：无 host-import 债；SDK 面只增 2 个能力；markdown 完全不受影响；扩展失败有 ErrorBoundary 隔离
- Cons：ImagePasteDialog/TableConvertDialog 双份，未来改动要同步两处；SDK 需先发新版本

## Requirements

### Phase 1: SDK 扩展 + host 渲染补齐
- `packages/extension-sdk/src/extension.ts`：`VaultApi` 加 `toAssetUrl`、`resolvePath`；新增 `VaultConfigApi` 接口（含 `getImagePath()`），挂到 `ExtensionApi.vaultConfig`（或并入 `VaultApi`）
- `apps/desktop/src/services/extension-host/createExtensionApi.ts`：实现上述两个 API（包装 `convertFileSrc`/`resolveBasePath`/`useVaultConfigStore.getState().imagePath`）
- `apps/desktop/src/components/work-area/WorkArea.tsx:256-268`：inline component 渲染时传 `vaultRoot`/`mode`/`readonly`/`signal`（对齐 `FilePresentationContext`）

### Phase 2: Rich-text 搬迁
- 建 `extensions/rich-text/`（mirror `extensions/dbml/` 的 `package.json`/`vite.config.ts`/`build.mjs`/`tsconfig.json`/`tailwind.config.js`/`postcss.config.js`/`manifest.json`）
- 移动 13 个 src 文件 + 2 个测试文件到 `extensions/rich-text/src/`
- 拷贝 `apps/desktop/src/components/editor/ImagePasteDialog.tsx` → `extensions/rich-text/src/dialogs/`
- 拷贝 `apps/desktop/src/components/editor/TableConvertDialog.tsx` → `extensions/rich-text/src/dialogs/`
- 拷贝 `imageUploader` 子集（`getStrategy`/`fileToBase64`/`convertImageFormat`/`LocalFileStrategy`）→ `extensions/rich-text/src/utils/imageUploader.ts`
- 拷贝/移动 `apps/desktop/src/services/export/richtext.ts` → `extensions/rich-text/src/exporters/richtextHtml.ts`（通过 `contributes.exporters` 注册）
- 拷贝 rich-text 图标 → `extensions/rich-text/src/icons/RichTextIcon.tsx`
- 替换 host import：
  - `useVaultStore` → `props.vaultRoot`
  - `useVaultConfigStore.getState().imagePath` → `api.vaultConfig.getImagePath()`
  - `convertFileSrc` → `api.vault.toAssetUrl(absPath)`
  - `resolveBasePath` → `api.vault.resolvePath(relPath)`
  - `useEditorPrefsStore.tablePasteMode` → `api.storage.get/set('tablePasteMode')`
- `manifest.json`：`tier: trusted`，`contributes.fileTypes: [{ id, handler, extensions: ['richtext'], defaultViewMode: 'edit', supportedViewModes: ['edit'] }]`，`contributes.fileTemplates: [{ id: 'rich-text-new', label: 'Rich Text', fileName: 'untitled.richtext', template: JSON.stringify(emptyDoc()) }]`，`contributes.exporters: [{ id, run, fileTypes: ['rich-text'], title: 'HTML', extension: '.html' }]`
- `src/index.tsx`：`export default { handlers: { 'rich-text': provider }, exporters: { richtextHtml }, activate(api, ctx) { setApi(api); setExtensionId(ctx.extensionId); } } satisfies ExtensionModule`
- 删除 `apps/desktop/src/components/file-types/rich-text/` 目录
- 删除 `apps/desktop/src/components/file-types/registry.ts` 中 glob 对 rich-text 的发现（目录没了，glob 自动不命中）
- 从 `apps/desktop/package.json` 移除 `@tiptap/*`、`@tiptap/extension-*`（移到 extension 的 package.json）
- 从 `apps/desktop/src/components/sidebar/ContextMenu.tsx` 删除 `NEW_FILE_GROUPS` 里的 `'rich-text'`（line 47）和 `fileTypeLabelKeys` 里的 `'rich-text'`（line 42）—— 动态 `extras` 机制自动接管
- 从 `apps/desktop/src/components/icons/FileIcon.tsx` 删除 `'rich-text'` 入口（line 66/82）—— 扩展自带 `RichTextIcon`
- 删除 `apps/desktop/src/services/export/richtext.ts` + 从 `apps/desktop/src/services/export/exporterRegistry.ts`/`vaultExport.ts` 注销 —— 扩展自带
- 更新 `.trellis/spec/desktop/frontend/file-type-editors.md` Rich Text 章节：标注「extension-provided via `extensions/rich-text/`」

## Acceptance Criteria

### Phase 1
- [ ] `packages/extension-sdk/src/extension.ts` 的 `VaultApi` 含 `toAssetUrl`/`resolvePath`；新增 `VaultConfigApi.getImagePath`
- [ ] `apps/desktop/src/services/extension-host/createExtensionApi.ts` 实现上述 API
- [ ] `WorkArea.tsx` inline component 渲染传 `vaultRoot`/`mode`/`readonly`/`signal`
- [ ] SDK `pnpm typecheck` 通过；`pnpm test packages/extension-sdk` 通过
- [ ] dbml extension 仍正常工作（回归验证）

### Phase 2
- [ ] `extensions/rich-text/` 作为独立 package 可 `pnpm build` 出自包含 ESM bundle
- [ ] desktop app 启动时通过扩展机制加载 rich-text handler，`.richtext` 文件能打开并编辑
- [ ] 图片粘贴/拖拽仍持久化到 vault `assets/images/`（通过新 SDK API）
- [ ] 图片 NodeView 用 `api.vault.toAssetUrl` 渲染 vault-relative src
- [ ] 表格粘贴 dialog（拷贝版本）正常弹出
- [ ] 数学公式 modal 正常工作
- [ ] AI 修改 `.richtext` 文件后，编辑器自动应用（remount 路径 + in-place 路径都验证）
- [ ] 命令面板出现 "New Rich Text"，执行后创建新 `.richtext` 文件
- [ ] 右键新建子菜单的扩展组出现 "Rich Text"
- [ ] `apps/desktop/src/components/file-types/rich-text/` 目录已删除
- [ ] `apps/desktop/package.json` 不再含 `@tiptap/*`
- [ ] `apps/desktop/src/components/sidebar/ContextMenu.tsx` 不再硬编码 `'rich-text'`
- [ ] `apps/desktop/src/components/icons/FileIcon.tsx` 不再含 `'rich-text'`
- [ ] HTML 导出（`.richtext` → `.html`）仍可用（通过扩展 `contributes.exporters`）
- [ ] `.trellis/spec/desktop/frontend/file-type-editors.md` Rich Text 章节标注「extension-provided」
- [ ] 测试搬迁并通过：`rich-text-handler.test.ts`、`RichTextSlashMenu.test.ts`

## Definition of Done

- Phase 1 / Phase 2 各自 lint + typecheck + test green
- dbml extension 回归通过（确保 SDK 改动未破坏既有扩展）
- markdown 编辑器回归通过（确保拷贝走的 dialog 不影响 markdown 那侧）
- spec 文档更新

## Out of Scope

- 抽 `@folyn/editor-shared` 共享包（只有 2 个编辑器时 YAGNI；第三个扩展有同样需求再做）
- `ImagePasteDialog`/`TableConvertDialog` 双份代码的同步自动化（人工维护）
- Markdown ↔ rich-text 转换（原本就 out of scope）
- 协作 / 多用户 / 实时同步（原本就 out of scope）
- Sandbox tier 迁移（trusted 已够用；sandbox 化是未来 P2 的事）
- iframe 隔离（tiptap React NodeView 必须在 host React 树，不适用）

## Technical Approach

### Phase 1 SDK 扩展（最小集，纯加法）

```ts
// packages/extension-sdk/src/extension.ts
export interface VaultApi {
  readText(path: string): Promise<string>;
  readBinary(path: string): Promise<Uint8Array>;
  writeText(path: string, content: string): Promise<void>;
  writeBinary(path: string, data: Uint8Array): Promise<void>;
  // NEW: 把 vault-relative / 绝对 fs path 转成可加载的 asset:// URL（Tauri-only）。
  toAssetUrl(fsPath: string): string;
  // NEW: 解析 `~`/`$HOME` 前缀的 vault-relative path 到绝对 fs path。
  resolvePath(relPath: string): Promise<string>;
}

// NEW: vault 级配置读取（用户设置）
export interface VaultConfigApi {
  // 图片持久化目录（默认 'assets/images/'），vault-relative。
  getImagePath(): string;
}

export interface ExtensionApi {
  readonly vault: VaultApi;
  readonly vaultConfig: VaultConfigApi;  // NEW
  // ... 其余不变
}
```

```ts
// apps/desktop/src/services/extension-host/createExtensionApi.ts
import { convertFileSrc } from '@tauri-apps/api/core';
import { resolveBasePath } from '@/utils/pathResolver';
import { useVaultConfigStore } from '@/store/vaultConfigStore';
import { isTauri } from '@/utils/platform';

function createVaultApi(): VaultApi {
  return {
    readText: (p) => ...,
    // ...
    toAssetUrl: (fsPath) => isTauri() ? convertFileSrc(fsPath) : fsPath,
    resolvePath: (rel) => resolveBasePath(rel),
  };
}
function createVaultConfigApi(): VaultConfigApi {
  return {
    getImagePath: () => useVaultConfigStore.getState().imagePath?.replace(/\/+$/, '') || 'assets/images/',
  };
}
```

### Phase 2 扩展包结构

```
extensions/rich-text/
├── package.json              # @folyn/extension-rich-text, deps: folyn-extension-sdk, @tiptap/*, react peer
├── vite.config.ts            # mirror dbml
├── build.mjs                 # mirror dbml
├── tsconfig.json
├── tailwind.config.js
├── postcss.config.js
└── src/
    ├── index.tsx             # export default { handlers, exporters, activate } satisfies ExtensionModule
    ├── manifest.json         # tier: trusted, contributes: { fileTypes, fileTemplates, exporters }
    ├── api.ts                # setApi/getApi pattern (mirror dbml)
    ├── RichTextEditor.tsx
    ├── RichTextToolbar.tsx
    ├── RichTextSlashMenu.tsx
    ├── RichTextSlashExtension.ts
    ├── RichTextImage.tsx
    ├── RichTextMathModal.tsx
    ├── TableControlsOverlay.tsx
    ├── TableMenu.tsx
    ├── markdownTablePaste.ts
    ├── markdownTable.ts
    ├── richTextExtensions.ts
    ├── richTextContent.ts
    ├── dialogs/
    │   ├── ImagePasteDialog.tsx  # 拷贝自 apps/desktop/src/components/editor/
    │   └── TableConvertDialog.tsx
    ├── exporters/
    │   └── richtextHtml.ts      # 移自 apps/desktop/src/services/export/richtext.ts
    ├── utils/
    │   └── imageUploader.ts     # 拷贝 getStrategy/fileToBase64/convertImageFormat/LocalFileStrategy
    └── icons/
        └── RichTextIcon.tsx
```

### 实施顺序（小 PR 拆分，已建子任务）

- **子任务 1 / PR1（Phase 1 SDK 扩展）**：`.trellis/tasks/09-11-rt-phase1-sdk` — SDK 加 `VaultApi.toAssetUrl`/`resolvePath` + `VaultConfigApi`；host `createExtensionApi` 实现；`WorkArea` 传 `vaultRoot` 等。dbml 回归测试。
- **子任务 2 / PR2（Phase 2 脚手架）**：`.trellis/tasks/09-11-rt-phase2-scaffold` — 建 `extensions/rich-text/` 包结构 + 空 `index.tsx` + manifest；desktop app 加载扩展（空 handler 验证加载链路）。
- **子任务 3 / PR3（Phase 2 搬迁清理）**：`.trellis/tasks/09-11-rt-phase2-relocate` — 移动 13 个 src 文件 + 拷贝 dialogs/utils/exporters/icons；替换 host import 为 SDK API；移除 `apps/desktop/src/components/file-types/rich-text/`；移除 `@tiptap/*` desktop 依赖；删除 `ContextMenu`/`FileIcon` 里 `'rich-text'` 硬编码；更新 spec。
- **子任务 4 / PR4（Phase 2 端到端验证）**：`.trellis/tasks/09-11-rt-phase2-verify` — 端到端测试（打开、编辑、图片粘贴、表格、AI apply、导出、新建文件），修复回归。

## Technical Notes

### 关键参考文件
- `extensions/dbml/src/index.tsx` — 扩展入口模式
- `extensions/dbml/src/manifest.json` — manifest 结构
- `extensions/dbml/package.json` / `vite.config.ts` / `build.mjs` — 打包配置
- `apps/desktop/src/components/file-types/rich-text/index.ts` — 当前 builtin handler
- `apps/desktop/src/components/file-types/registry.ts` — builtin glob 注册
- `apps/desktop/src/components/work-area/WorkArea.tsx:256-268` — inline component 渲染点
- `apps/desktop/src/services/extension-host/createExtensionApi.ts` — ExtensionApi 实现
- `apps/desktop/src/services/extension-host/fileTemplateAdapter.ts` — FileTemplateContribution 适配
- `apps/desktop/src/components/sidebar/ContextMenu.tsx:99-115` — 动态扩展组机制
- `apps/desktop/src/components/shell/Topbar.tsx:111` — `showViewMode = modes.length > 1` 自动隐藏
- `packages/extension-sdk/src/extension.ts` — VaultApi/ExtensionApi 定义
- `packages/extension-sdk/src/presentation.ts` — FileTypeProvider/FilePresentationContext
- `packages/extension-sdk/src/contracts.ts` — ExtensionModule
- `packages/extension-sdk/src/types.ts:328` — FileTemplateContribution（已存在）
- `.trellis/spec/desktop/frontend/file-type-editors.md` §「Tiptap Rich Text Editor」
- `Folyn-Extension-System-Refactor-Technical-Design.md` — 目标架构设计

### ponytail 简化
- 不抽 `@folyn/editor-shared`：只有 markdown + rich-text 两个消费者，YAGNI；双份 dialog 代码人工同步。
- 不做 iframe 隔离：tiptap React NodeView 必须 host React 树。
- 不做 sandbox tier：trusted 已够用；sandbox 化是 P2 的事。
- `FileTemplateContribution` 已经存在，直接用；不发明新机制。
- `ContextMenu` 动态扩展组机制已经存在，删除硬编码即可；不发明新 UI。
