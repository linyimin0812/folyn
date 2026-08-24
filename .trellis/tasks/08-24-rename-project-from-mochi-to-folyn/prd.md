# Rename project from Mochi to Folyn

## Goal

把项目名 `mochi` / `Mochi` / `MOCHI` 全量改为 `folyn` / `Folyn` / `FOLYN`。沿用 08-24-rename-project-from-quill-to-mochi 的范围与决策。

## Scope (same as previous rename)

**全量改名**：所有出现 `mochi` / `Mochi` 的地方统一替换。包括：
- 包名 `@mochi/*` → `@folyn/*`，`mochi-plugin-sdk` → `folyn-plugin-sdk`，`create-mochi-plugin` → `create-folyn-plugin`
- Rust crate `mochi` → `folyn`，`mochi_lib` → `folyn_lib`
- Tauri `identifier: com.mochi.editor` → `com.folyn.editor`，productName、file association name、所有窗口 title
- clipboard MIME `application/x-mochi-table-{row,col}` → `x-folyn-table-{row,col}`
- 事件 channel `mochi:*` → `folyn:*`，localStorage key `mochi:locale` → `folyn:locale`
- Home dir `~/.mochi/*` → `~/.folyn/`，`%LOCALAPPDATA%\mochi\logs` → `\folyn\logs`
- 6 i18n locales × {settings,ai}.json，6 README 翻译，docs 站点（含 `Mochi.html`/`Mochi_files/`/`mochi-app.css`/`mochi.svg` 文件名 + 内部引用）
- 展示文案中 `<em>` 拆字：`Mo<em>chi</em>` → `Fo<em>lyn</em>`（Topbar.tsx + docs/index.html + docs/Mochi.html 快照，文件名 Mochi.html → Folyn.html）
- 目录 mv `packages/create-mochi-plugin/` → `packages/create-folyn-plugin/`
- `.trellis/spec/**` 与活动 task 文件里的 `@mochi/*` 引用

## Out of Scope

- `pnpm-lock.yaml` / `package-lock.json` — 用户重生成
- `.trellis/tasks/archive/**` — 历史
- `.trellis/workspace/**` — 历史 journal
- `.dev/worktree/**`、`apps/desktop/dist/**`、`node_modules/**`、`.git/**`、`target/**`、`learning/**`
- 当前任务目录 `.trellis/tasks/08-24-rename-project-from-mochi-to-folyn/**`
- 根目录 mv `/Users/yiminlin/project/quill` → `/Users/yiminlin/project/folyn`（用户自己做；上次 quill→mochi 时还没 mv，此次一起决定）

## Acceptance Criteria

- [ ] `grep -rni 'mochi'` 在 Out of Scope 之外 0 命中
- [ ] `Mo<em>chi</em>` → `Fo<em>lyn</em>`（保留 italic 拆字样式）
- [ ] 包元数据、Rust crate、tauri identifier、clipboard MIME、event channel、localStorage key、home dir 路径全部改名
- [ ] docs 站点文件 mv 完成（Mochi.html → Folyn.html 等）

## Definition of Done

- 改名覆盖上述所有类别
- 不跑 `pnpm build` / `cargo build`（用户偏好）
- 不 commit；完成后告知用户哪些文件改了 + followup

## Technical Notes

参考上一次任务 PRD：`.trellis/tasks/08-24-rename-project-from-quill-to-mochi/prd.md`。
上次 commit：`bdc35c32`（重命名主体）+ `ec9f96b3`（`<em>` 拆字补丁）。

替换顺序（最长先，避免双重替换）：
1. `create-mochi-plugin` → `create-folyn-plugin`
2. `mochi-plugin-sdk` → `folyn-plugin-sdk`（实际可写 `mochi-plugin-` → `folyn-plugin-`，覆盖两种）
3. `@mochi/` → `@folyn/`
4. `mochi_lib` → `folyn_lib`
5. `mochi-lib` → `folyn-lib`
6. `com.mochi.editor` → `com.folyn.editor`
7. `application/x-mochi-` → `application/x-folyn-`
8. bare `mochi`/`Mochi`/`MOCHI` (case-sensitive)
9. 单独扫 `Mo<em>chi</em>` → `Fo<em>lyn</em>`（HTML 拆字，perl 不会匹配）
