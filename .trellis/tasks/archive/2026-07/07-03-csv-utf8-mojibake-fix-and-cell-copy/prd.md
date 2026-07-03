# CSV UTF-8 乱码修复 + 单元格复制

## Goal

修复 CsvFileViewerPreview 预览中文 UTF-8 CSV 时乱码的问题；修复 Tauri webview 下 CSV 表格选中单元格后 Cmd/Ctrl+C 复制失效的问题，使粘贴到 Excel/记事本即为表格（TSV）。

## What I already know

- 入口组件 `apps/desktop/src/components/file-types/csv/CsvFileViewerPreview.tsx`：把 `content` 字符串包成 `new File([content ?? ''], name, { type: 'text/csv' })`，交给 `@file-viewer/react` + `@file-viewer/preset-office`。
- `content` 来自 editorStore tab state，已由 Tauri `readTextFile`（UTF-8）解码为 JS 字符串。
- 底层 spreadsheet renderer（`@file-viewer/renderer-spreadsheet@2.1.17`，已 patch）的 parser `dist/spreadsheet/worker/sheetjs/parser.js` 调 `styled-exceljs` 的 `read(data, { type: 'array', ... })`，`readOptions` **未指定 `codepage`** → 无 BOM 的 UTF-8 CSV 默认按 latin-1 解码 → 中文乱码。
- 团队已有 patch 路线：`patches/@file-viewer__renderer-spreadsheet@2.1.17.patch`、`patches/e-virt-table@1.4.2.patch`。
- **复制能力 renderer 已内置**：`dist/spreadsheet/view.js` 设 `ENABLE_SELECTOR: true`、`ENABLE_COPY: true`、`BEFORE_COPY_METHOD: copySelection`；`dist/spreadsheet.js` 的 `copySpreadsheetSelection` 调 `writeSpreadsheetClipboard` 走 `navigator.clipboard.writeText`（安全上下文）+ `execCommand('copy')` textarea 兜底。
- **复制失效根因（research 已确认）**：WKWebView 对 `tauri://localhost` 自定义 scheme 的 `navigator.clipboard.writeText` 会 reject；renderer 的 `writeSpreadsheetClipboard` 是 async，catch 分支里 `execCommand('copy')` 在 Promise microtask 中执行，已脱离 keydown 用户手势 → WKWebView 拒绝，返回 false。`e-virt-table` 本身同步派发 copy 事件，断点在 renderer 的 async 包装。
- Tauri 侧目前**未装** `tauri-plugin-clipboard-manager`（Cargo.toml / package.json / capabilities/default.json 均无）。`apps/desktop/src-tauri/capabilities/default.json` 已有 fs/shell/dialog 权限体系，加 clipboard 权限符合既有模式。

## Requirements

- [R1] UTF-8（无 BOM）中文 CSV 预览不再乱码：在 `CsvFileViewerPreview.tsx` 构造 File 前给 `content` 预置 UTF-8 BOM（`\uFEFF`），若 content 已以 BOM 开头则不重复。
- [R2] Tauri webview 下，CSV 预览表格选中单元格 + Cmd/Ctrl+C 能把选区以 TSV 写入系统剪贴板，粘贴到 Excel/记事本即为表格。
- [R3] 不破坏 xlsx 预览：R1 只动 CSV 预览组件，R2 patch 仅在 `window.__TAURI_INTERNALS__` 存在时改走 Tauri 插件，浏览器环境行为不变。
- [R4] patch 升级影响可控：renderer patch 只改 `writeSpreadsheetClipboard` 单一函数。

## Acceptance Criteria

- [ ] 打开 UTF-8（无 BOM）中文 CSV，预览表格中文正常显示，无乱码。
- [ ] 打开已带 UTF-8 BOM 的 CSV，预览不出现多余空列或乱码（BOM 不被重复）。
- [ ] 鼠标拖选单元格范围，Cmd/Ctrl+C，粘贴到 Excel/记事本得到对应行列；选区高亮被 `markCopiedSelection` 标记。
- [ ] 既有 xlsx 预览回归正常（不引入副作用）。
- [ ] `pnpm typecheck`、`pnpm test`、lint 全绿；Tauri 端 `cargo check` 通过。
- [ ] renderer patch 仍可干净应用（`pnpm install` 后 `patched-fails` 为 0）。

## Definition of Done

- 单元/集成测试覆盖：BOM 预置逻辑（含已带 BOM 的输入）；不动 renderer 内部（patch 不另加测试，靠手动 + 既有 xlsx 回归）。
- Lint / typecheck / CI 绿；`cargo check` 绿。
- 在 `apps/desktop/src-tauri/Cargo.toml`、`apps/desktop/src-tauri/capabilities/default.json`、`apps/desktop/src-tauri/src/lib.rs`、`apps/desktop/package.json`（或 workspace 根 package.json）中新增 clipboard 插件依赖与权限注册。
- 在 `patches/@file-viewer__renderer-spreadsheet@2.1.17.patch` 追加对 `writeSpreadsheetClipboard` 的 Tauri 分支 patch；保持既有 patch 内容不变。
- 如 spec 有相关条目，更新 `.trellis/spec/desktop/frontend/file-type-editors.md` 备注 CSV 预览的 BOM 与 Tauri clipboard 通道。

## Technical Approach

### R1 乱码修复（BOM 预置）

`CsvFileViewerPreview.tsx`：

```tsx
const file = useMemo(() => {
  const name = filePath.split('/').pop() || 'data.csv';
  const body = content ?? '';
  // SheetJS 对无 BOM 的 UTF-8 CSV 默认按 latin-1 解码 → 中文乱码。
  // 预置 UTF-8 BOM 让 SheetJS 走 UTF-8 路径；已带 BOM 不重复。
  const prefixed = body.startsWith('\uFEFF') ? body : '\uFEFF' + body;
  return new File([prefixed], name, { type: 'text/csv' });
}, [content, filePath]);
```

### R2 复制修复（Tauri clipboard 插件 + renderer patch）

依赖：
- `apps/desktop/src-tauri/Cargo.toml`：`tauri-plugin-clipboard-manager = "2"`。
- `apps/desktop/src-tauri/src/lib.rs`：`.plugin(tauri_plugin_clipboard_manager::init())`。
- `apps/desktop/src-tauri/capabilities/default.json`：追加 `"clipboard-manager:allow-write-text"`（`allow-read-text` 暂不加，留给后续 paste）。
- `apps/desktop/package.json`：`@tauri-apps/plugin-clipboard-manager: ^2`。

renderer patch（追加到 `patches/@file-viewer__renderer-spreadsheet@2.1.17.patch`）：在 `dist/spreadsheet.js` 的 `writeSpreadsheetClipboard` 函数顶部插入 Tauri 分支：

```diff
 const writeSpreadsheetClipboard = async (documentRef, text) => {
+    if (typeof globalThis !== 'undefined' && globalThis.__TAURI_INTERNALS__) {
+        try {
+            const mod = await import('@tauri-apps/plugin-clipboard-manager');
+            await mod.writeText(text);
+            return true;
+        } catch (e) {
+            console.error('Tauri clipboard writeText failed:', e);
+        }
+    }
     const targetWindow = documentRef.defaultView;
     const clipboard = targetWindow?.navigator?.clipboard;
     ...
 };
```

要点：
- `globalThis.__TAURI_INTERNALS__` 是 Tauri 2.x 注入标记，dev/release 均存在。
- 动态 `import()` 避免把 Tauri 插件变为非 Tauri 环境的硬依赖。
- Tauri `writeText` 在 Rust 侧写 NSPasteboard，不经 WKWebView 手势门，根治 async 失效。
- 保留既有 web 分支作为非 Tauri 兜底。

## Decision (ADR-lite)

**Context**：CSV 预览中文乱码 + 复制失效两个独立 bug。乱码源于 SheetJS 默认 codepage；复制失效源于 WKWebView 对 `tauri://` 自定义 scheme 的 async clipboard 限制 + renderer 的 async 包装打断用户手势。

**Decision**：
- 乱码走"预置 BOM"而非"扩展 patch 设 codepage"，因为前者 1 行改动、不动 patch、只影响 CSV 预览、不波及 xlsx。
- 复制走"加 Tauri clipboard 插件 + patch renderer 的 `writeSpreadsheetClipboard`"而非"在 React 层拦截 Cmd/Ctrl+C"，因为 React 层拿不到 `e-virt-table` 选区实例，自建选区脆弱；renderer 已有 TSV 序列化和单一 choke-point，patch 一个函数即可。

**Consequences**：
- 新增 1 个 Rust crate + 1 个 npm 依赖 + 1 条 capability 权限，体积可控。
- renderer patch 增加一条分支，升级 `@file-viewer/renderer-spreadsheet` 时需重打；但只改一个函数，维护负担低。
- 仅解决 CSV/xlsx 预览的复制；其他 renderer（如 docx/pptx）的复制如未来有需求另开任务。

## Out of Scope

- GBK/GB18030 编码 CSV 的自动识别与转码（场景已限定 UTF-8）。
- CSV 编辑器侧改动（仅动预览）。
- 整表一键复制按钮（用户已选"选中复制"）。
- paste 支持（只做 write 方向；read 权限暂不加）。
- docx/pptx 等其他 renderer 的剪贴板通路（仅 spreadsheet）。

## Research References

- [`research/tauri-clipboard-copy-failure.md`](research/tauri-clipboard-copy-failure.md) — 复制失效根因（WKWebView 自定义 scheme async clipboard reject + renderer async 包装打断手势）+ 推荐修法（Tauri clipboard 插件 + patch `writeSpreadsheetClipboard`）。

## Technical Notes

- 关键文件：
  - `apps/desktop/src/components/file-types/csv/CsvFileViewerPreview.tsx`（BOM 预置）
  - `apps/desktop/src-tauri/Cargo.toml`、`apps/desktop/src-tauri/src/lib.rs`、`apps/desktop/src-tauri/capabilities/default.json`（clipboard 插件 + 权限）
  - `apps/desktop/package.json`（`@tauri-apps/plugin-clipboard-manager`）
  - `patches/@file-viewer__renderer-spreadsheet@2.1.17.patch`（追加 `writeSpreadsheetClipboard` Tauri 分支）
  - `node_modules/.pnpm/@file-viewer+renderer-spreadsheet@.../dist/spreadsheet.js`（patch 目标）
  - `node_modules/.pnpm/@file-viewer+renderer-spreadsheet@.../dist/spreadsheet/worker/sheetjs/parser.js`（readOptions，仅参考）
- patch 流程：`pnpm patch @file-viewer/renderer-spreadsheet@2.1.17` → 编辑 `dist/spreadsheet.js` → `pnpm patch-commit <tmpdir>` → 合并到既有 `patches/@file-viewer__renderer-spreadsheet@2.1.17.patch`。
- 测试策略：vitest 覆盖 `CsvFileViewerPreview` 的 BOM 预置（已带 BOM / 无 BOM 两种输入）；Tauri 端 `cargo check` 验证插件注册；手动在 Tauri webview 实测复制 + 中文 CSV 乱码。
