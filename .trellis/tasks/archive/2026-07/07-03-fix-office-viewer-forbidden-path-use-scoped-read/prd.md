# fix: office viewer forbidden path (expand ~ before read)

## Goal

修复 OfficeFileViewer "forbidden path: ~/quill/..." 错误——`vaultRoot` prop 带字面 `~`，`@tauri-apps/plugin-fs.readFile` 不展开 `~`，路径不匹配 `fs:scope-home-recursive` 被拒。

## What I already know

- `OfficeFileViewer.tsx`：`const abs = vaultRoot.replace(/\/+$/,'') + '/' + filePath...` 后 `readFile(abs)`——未展开 `~`。
- `utils/pathResolver.ts` 的 `resolveBasePath(basePath)`：`~` 开头则用 `homeDir()` 展开，返回绝对路径。clipService 已用它。
- TauriVaultProvider.connect 会展开 `~` 存 `basePath`，所以 vault 文本读正常；但 `vaultRoot` prop 是原始 `config.basePath`（带 `~`）。
- `fs:scope-home-recursive` 已启用——展开 `~` 后的 `$HOME/...` 路径允许读。
- `@tauri-apps/api/path.join` 可做平台安全路径拼接。

## Requirements

- OfficeFileViewer 读字节前先 `resolveBasePath(vaultRoot)` 展开 `~`，再用 `join(abs, filePath)` 拼路径，最后 `readFile`。
- 其余逻辑（File/FileViewer/加载错误态）不变。

## Acceptance Criteria

- [ ] 打开 vault 内 Office/CSV/PDF 文件不再 "forbidden path"。
- [ ] 路径含空格（如 "claude code"）正常读取。
- [ ] tsc + vitest 绿；vite build 成功。

## Out of Scope

- 不改 vault-provider（不加 readFileBytes）。
- 不改 tauri capabilities。
- 不动其它 handler。

## Technical Notes

- 改 `components/file-types/office/OfficeFileViewer.tsx` 的 effect：`const base = await resolveBasePath(vaultRoot); const abs = await join(base, filePath); const bytes = await readFile(abs);`
