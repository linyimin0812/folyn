# Rich-text Migration Phase 1: SDK Extension + WorkArea Render

> Parent: [`09-11-migrate-rich-text-type-to-extension`](../09-11-migrate-rich-text-type-to-extension/prd.md)

## Goal

扩展 `folyn-extension-sdk` 的 `VaultApi`，新增 `VaultConfigApi`，并修 `WorkArea` 渲染 inline `kind: 'component'` 时的 props 透传缺口，使后续 Phase 2 rich-text 扩展搬迁后无 host-import 残留。

## Requirements

### SDK 扩展（`packages/extension-sdk/src/extension.ts`）

1. `VaultApi` 新增：
   - `toAssetUrl(fsPath: string): string` — 把绝对 fs path 转成可加载 URL（Tauri 走 `convertFileSrc` → `asset://`；非 Tauri 原样返回）
   - `resolvePath(relPath: string): Promise<string>` — 解析 `~`/`$HOME` 前缀到绝对 fs path
2. 新增 `VaultConfigApi` 接口：
   - `getImagePath(): string` — 读 host 用户设置的图片持久化目录（默认 `'assets/images/'`，已 trim 末尾 `/`）
3. `ExtensionApi` 加 `readonly vaultConfig: VaultConfigApi`

### Host 实现（`apps/desktop/src/services/extension-host/createExtensionApi.ts`）

1. `createVaultApi()` 实现 `toAssetUrl`（包装 `@tauri-apps/api/core` 的 `convertFileSrc`，非 Tauri 短路）+ `resolvePath`（包装 `@/utils/pathResolver` 的 `resolveBasePath`）
2. 新 `createVaultConfigApi()`：`getImagePath()` 读 `useVaultConfigStore.getState().imagePath?.replace(/\/+$/, '') || 'assets/images/'`
3. `createExtensionApi` 把 `vaultConfig` 挂到返回的 `api` 对象

### WorkArea 渲染补齐（`apps/desktop/src/components/work-area/WorkArea.tsx:256-268`）

- inline `kind: 'component'` 渲染处给 `<InlineEditor>` 传 `vaultRoot`/`mode`/`readonly`/`signal`（对齐 SDK 的 `FilePresentationContext` 字段）
- `key` 保持 `${activeTab.id}-${externalContentVersion}` 不变
- 不破坏现有 `EditorProps` shape；只是补字段（React 组件可多收 props）

### 不改动

- `FileTemplateContribution` 已 wired，不动
- `ContextMenu` 动态扩展组机制不动
- `Topbar` 不动（`showViewMode = modes.length > 1` 已自动）
- AI apply 路由不动

## Acceptance Criteria

- [ ] `packages/extension-sdk/src/extension.ts` 的 `VaultApi` 含 `toAssetUrl`/`resolvePath`；`ExtensionApi` 含 `vaultConfig: VaultConfigApi`
- [ ] `apps/desktop/src/services/extension-host/createExtensionApi.ts` 实现上述两个 API 并挂到 `api`
- [ ] `WorkArea.tsx:256-268` 给 inline component 传 `vaultRoot`/`mode`/`readonly`/`signal`
- [ ] `pnpm typecheck`（SDK + desktop）通过
- [ ] `pnpm test packages/extension-sdk` 通过（既有测试不破坏）
- [ ] dbml extension 回归：打开 `.dbml` 文件、ER 预览、Edit/Split/Preview 三模式正常
- [ ] 现有 builtin rich-text 仍正常工作（Phase 2 才搬它）

## Definition of Done

- lint / typecheck / test green
- dbml 回归通过
- markdown 编辑器回归通过（验证 inline component props 变化未破坏 Excalidraw/HTML 等其他 custom editor）
- 不修改任何 rich-text 文件（Phase 2 才动）

## Out of Scope

- 任何 rich-text 文件搬迁（Phase 2）
- `@folyn/editor-shared` 抽包
- `ExtensionModule.templates` 字段（不需要；`FileTemplateContribution` 已纯声明式）

## Technical Notes

### 关键参考文件
- `packages/extension-sdk/src/extension.ts` — `VaultApi`/`ExtensionApi` 定义点
- `apps/desktop/src/services/extension-host/createExtensionApi.ts:78,214` — `createVaultApi` + `api` 装配点
- `apps/desktop/src/components/work-area/WorkArea.tsx:256-268` — inline component 渲染点
- `apps/desktop/src/utils/pathResolver.ts` — `resolveBasePath`（host 已有）
- `apps/desktop/src/utils/platform.ts` — `isTauri()`
- `apps/desktop/src/store/vaultConfigStore.ts` — `useVaultConfigStore.imagePath`
- `apps/desktop/src/components/file-types/rich-text/RichTextImage.tsx:108,110,111` — 当前直接 import 的三处，Phase 2 改 SDK API 时要参照
- `apps/desktop/src/components/file-types/rich-text/RichTextEditor.tsx:38,39,41` — 同上
- `extensions/dbml/src/index.tsx` — 扩展入口模式（参考）
- `extensions/dbml/src/api.ts` — `setApi/getApi` 模式（参考）

### 验证 inline component 改动不破坏其他 editor
`WorkArea.tsx:256-268` 渲染所有 `kind: 'component'` 的 inline editor（Excalidraw / rich-text / web 等）。补传 `vaultRoot`/`mode`/`readonly`/`signal` 是 additive 的，组件可选择忽略；但需手测 Excalidraw（drawio 类）、HTML visual、web view 三类不回归。
