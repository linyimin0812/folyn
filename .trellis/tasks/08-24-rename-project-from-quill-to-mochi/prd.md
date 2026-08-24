# Rename project from Quill to Mochi

## Goal

将项目名从 `quill` / `Quill` 统一改为 `mochi` / `Mochi`，避免与已占用的 `quill` 名字冲突。覆盖 package.json、Cargo.toml、tauri.conf.json、i18n 文案、workspace 包名、docs 站点、clipboard MIME key、内部日志路径等所有出现 "quill" 的地方。

## What I already know

项目使用 tiptap（非 Quill.js 库），所以仓库内所有 `quill` / `Quill` 均指项目本身，无第三方库命名冲突。

### 受影响的文件清单（按类别）

**包元数据**
- 根 `package.json`：`name: "quill"`、description
- `apps/desktop/package.json`：`@quill/desktop` + 6 个 `@quill/*` 与 `quill-plugin-sdk` 依赖引用
- `packages/cli-adapter/package.json`：`@quill/cli-adapter`
- `packages/container-plugins/package.json`：`@quill/container-plugins` + description
- `packages/create-quill-plugin/package.json`：`create-quill-plugin`（可发布到 npm）
- `packages/plugin-host/package.json`：`@quill/plugin-host` + description
- `packages/plugin-sdk/package.json`：`quill-plugin-sdk` v0.1.2（可发布到 npm）
- `packages/vault-provider/package.json`：`@quill/vault-provider` + description
- `pnpm-lock.yaml`：lockfile 引用

**Rust / Tauri**
- `apps/desktop/src-tauri/Cargo.toml`：crate `quill`、lib `quill_lib`、description
- `apps/desktop/src-tauri/tauri.conf.json`：`productName`、`identifier: com.quill.editor`、所有 file association `name`（"Quill Markdown" 等）、所有窗口 title
- `apps/desktop/src-tauri/src/lib.rs`：crate 引用、identifier 引用
- `apps/desktop/src-tauri/src/commands/pet_common.rs` 等：日志路径 `%LOCALAPPDATA%\quill\logs`

**前端代码 / i18n**
- `apps/desktop/src/i18n/locales/{en,zh,ja,fr,de,es}/{settings,ai}.json`：展示文案 "Quill"
- `apps/desktop/src/components/**`：多处展示文案
- `apps/desktop/src/services/petHostRouter.ts`、`externalFileProvider.ts` 等
- `apps/desktop/src/components/file-types/rich-text/RichTextEditor.tsx`：clipboard MIME key `application/x-quill-table-row` / `-col`

**docs 站点**
- `docs/Quill.html`、`docs/Quill_files/`（含 `quill.svg`）、`docs/quill-app.css`
- `docs/assets/icons/quill.svg`
- `docs/locales/{en,zh,ja,fr,de,es}.json` + `docs/i18n.js`
- 各 `.html` 页面里的 "Quill" 字样

**README**
- 6 个 README 文件（en/zh/ja/fr/de/es）

## Open Questions

- 范围：是否包含 macOS bundle identifier `com.quill.editor`、已发布的 npm 包名（`quill-plugin-sdk`、`create-quill-plugin`）、clipboard MIME key、目录名？
- 仓库根目录 `/Users/yiminlin/project/quill` 文件夹本身是否要 mv？

## Requirements (evolving)

- 所有用户可见的 "Quill" 展示名 → "Mochi"
- 所有包元数据 name 字段统一改名

## Acceptance Criteria (evolving)

- [ ] 全仓库 `grep -ri quill` 不再命中项目名相关引用（仅剩历史 changelog / commit 等）
- [ ] `pnpm install` 成功，workspace 包互引正常
- [ ] `cargo build` / `tauri build` 成功
- [ ] 应用启动后窗口标题、关于页、设置页展示 "Mochi"
- [ ] docs 站点打开后所有页面展示 "Mochi"

## Definition of Done

- 改名覆盖清单中所有类别
- 已有测试通过（`vitest run`）
- 不引入新的依赖

## Out of Scope

- git history 重写（commit message 中的 quill 保留）
- `.trellis/tasks/**` 历史任务文件
- 已发布到 npm 的包的 unpublish / deprecation

## Technical Notes

- 项目用 tiptap，不是 Quill.js 库 — 所有 `quill` 字样都是项目名
- clipboard MIME key `application/x-quill-table-row` / `-col` 是 RichTextEditor 内部数据格式，改名要同时改写入端和读取端
- Tauri bundle identifier 改动会让已安装的旧版本无法识别为新版本（视为不同 app）
