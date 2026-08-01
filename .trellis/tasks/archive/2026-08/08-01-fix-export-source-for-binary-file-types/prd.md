# fix export source for binary file types

## Goal

修复 `exportActiveSource`（下载源码）对二进制文件类型（PDF 等 office handler 覆盖的类型）下载空文件的 bug。根因：`exportActiveSource` 一律从 `tab.content`（string）构造 blob，但 office handler `needsFileContent: false`，`tab.content` 永远是 `''`。

## What I already know

- 入口：`apps/desktop/src/hooks/useExport.ts:59-66` `exportActiveSource` 用 `new Blob([content])` 下载。
- `getActiveDocument()` 从 `useEditorStore` 读 `tab.content`。
- office handler `apps/desktop/src/components/file-types/office/index.ts:50` `needsFileContent: false`，覆盖 pdf/docx/xlsx/zip/mp4/...几乎所有二进制类型。
- `openFile`（`apps/desktop/src/services/editorIoService.ts:137`）对 `needsFileContent: false` 跳过内容读取 → `tab.content = ''`。
- 现有二进制读取能力：
  - `externalFileProvider.readFileBytes`（`apps/desktop/src/services/externalFileProvider.ts:61-66`）已存在，返回 `Uint8Array`。
  - vault 侧只有 `writeFileBytes`（`packages/vault-provider/src/providers/tauriProvider.ts:89`），没有 `readFileBytes`。
- `downloadBlob`（`apps/desktop/src/services/export/shared.ts:191`）已支持 Blob → 文件，二进制 Blob 走同一通道。
- SVG handler `needsFileContent: true`，`tab.content` 应有值——SVG 空文件是另一个问题，**本任务不处理**。

## Requirements

- `exportActiveSource` 对 `needsFileContent: false` 的文件类型，从磁盘读原始字节构造 Blob 下载，保留原始字节（不经过 UTF-8 string 往返）。
- 对 `needsFileContent: true` 的文本类型（含未保存编辑），保持现有 `tab.content` 路径不变。
- vault-provider 抽象层增加 `readFileBytes`（与 `writeFileBytes` 对称），TauriVaultProvider 实现，VaultManager 暴露并带 fallback。
- 外部路径（`~`/绝对路径）走 `externalFileProvider.readFileBytes`。
- wiki 前缀路径不进二进制分支（wiki 全是文本，且 office 类型不会出现在 wiki）。

## Acceptance Criteria

- [ ] 打开 vault 内 PDF 文件，导出菜单「下载源码」得到与原文件字节数相同的非空 PDF。
- [ ] 打开外部 PDF（`~/` 下），导出源码同样得到非空 PDF。
- [ ] 打开 zip/docx/mp4 等其他 office handler 类型，导出源码均非空、可被对应程序打开。
- [ ] 文本类型（md/svg/json/code）导出源码仍包含未保存编辑（不退化）。
- [ ] `pnpm typecheck` 通过；vault-provider 包 `pnpm test` 通过。

## Definition of Done

- TauriVaultProvider + VaultManager + providerInterface 三处对称扩展 `readFileBytes`。
- `exportActiveSource` 分支逻辑 + 最小自检/单测。
- 不引入新依赖。

## Technical Approach

### 文件改动（4 个）

1. `packages/vault-provider/src/providerInterface.ts` — 加 `readFileBytes?(path: string): Promise<Uint8Array>`（与 `writeFileBytes?` 对称）。
2. `packages/vault-provider/src/providers/tauriProvider.ts` — 实现 `readFileBytes`：`readFile` from `@tauri-apps/plugin-fs`（返回 Uint8Array），通过 `this.resolve` 拼绝对路径。
3. `packages/vault-provider/src/vaultManager.ts` — 加 `readFileBytes(path)`：provider 有则转发，否则 fallback `new TextEncoder().encode(provider.readFile(path))`（与 `writeFileBytes` 的 fallback 对称）。
4. `apps/desktop/src/hooks/useExport.ts` — `exportActiveSource` 改造：
   - 取 active tab + handler。
   - `handler?.needsFileContent === false` → 读字节路径分支：external 走 `externalFileProvider.readFileBytes`，vault 走 `useVaultStore.getState().manager.readFileBytes(path)`；构造 `new Blob([bytes], { type: 'application/octet-stream' })`。
   - 否则保留现有 `tab.content` 文本路径。
   - mime：二进制统一 `application/octet-stream`（保留原扩展名即可，下载方按扩展识别）。

### 不改动

- `openFile` 不变（office handler 仍然不读 content，预览走 OfficeFileViewer 自己处理）。
- `saveFile` 不动（office 类型不可编辑，没有 save 路径）。

## Decision (ADR-lite)

**Context**: 二进制源码导出需要字节保真的读取路径，目前 vault 抽象只有 `writeFileBytes`，没有 `readFileBytes`。

**Decision**: 对称扩展 `readFileBytes?` 可选方法，TauriVaultProvider 实现，VaultManager 带 TextEncoder fallback。`exportActiveSource` 按 `handler.needsFileContent` 分支。

**Consequences**: 
- GithubVaultProvider 暂不实现 `readFileBytes`，会走 fallback（TextEncoder 编码 string），对真正二进制 PDF 仍是损坏的——但 GitHub vault 当前连 office 文件打开都依赖 `OfficeFileViewer` 自身的字节获取，不在本修复路径上。后续若要支持，GithubVaultProvider 需自行实现 `readFileBytes`（GitHub API `GET /repos/:owner/:repo/contents/:path` 原始字节）。
- 用户当前只在本地 vault 复现此 bug，本地路径修复即覆盖报障范围。

## Out of Scope

- SVG 空文件问题（`needsFileContent: true`，路径不同，单独追查）。
- GithubVaultProvider 的 `readFileBytes` 实现（YAGNI，未报障）。
- office handler 的 `needsFileContent` 改为 true（影响面大，非本 bug 范围）。
- 导出源码时的进度提示/错误 toast（已有 console.error，UI 化是另一事）。

## Technical Notes

- `@tauri-apps/plugin-fs` 的 `readFile(path)` 返回 `Uint8Array`（不是 `readTextFile`）。
- `new Blob([uint8array])` 在 Tauri WebView 中走 `Blob.arrayBuffer()` → `writeFile` 落盘（`shared.ts:204-205` 已验证该通道对二进制有效）。
- 字节路径不经过 `handler.serialize` / `handler.deserialize`，因为 office handler 没有这俩（`needsFileContent: false`）。
