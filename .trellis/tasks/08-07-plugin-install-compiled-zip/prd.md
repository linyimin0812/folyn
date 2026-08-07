# Plugin install: compiled-only + zip upload

## Goal

让用户安装插件时上传**编译后的产物**（`manifest.json` + `dist/` + 静态资源），而不是完整插件源码（`src/`、`node_modules/`、`tsconfig.json`、`package*.json` 等）。同时支持 `.zip` 包上传，作为主要分发形态。

**Why**: 现状 `install_plugin` 把整个选中目录递归拷到 `~/.quill/plugins/<id>/`，没有任何「源码 vs 产物」区分，体积大、暴露源码、且与未来签名链不兼容。代码注释里 zip 已被标为 PR4 待办，本次落地。

## What I already know

- 安装入口：`plugin_commands.rs:467` `install_plugin(id, source_path)`，要求 `source_path` 是含 `manifest.json` 的目录，整目录拷贝。
- 前端：`PluginsSettings.tsx:281` 走 `@tauri-apps/plugin-dialog` `open({directory: true})` 选文件夹；`pluginStore.ts:212` 调 `invoke('install_plugin', {id, sourcePath})`，`id` 由文件夹名推导。
- 存储布局：`~/.quill/plugins/<id>/`，注册表 `plugins.json`（`PluginEntry` 含 `integrity: HashMap<relpath, sha256>`）。
- 完整性校验：装时算每文件 SHA-256；trusted loader 在 `import()` 前重算 `main` 的哈希比对——是真正的安全边界。
- Manifest schema（`packages/plugin-sdk/src/types.ts:84`）：必填 `id/name/version/tier/main`，sandbox 还要 `html`，可选 `permissions/contributes/signature/publisherPublicKey`。
- Trusted `main` 是 ESM 入口（如 `dist/index.js`），通过 `read_plugin_file` 读出后塞进 blob URL `import()`。
- Cargo.toml **没有** `zip` crate，需要新增依赖。
- CSP：`script-src 'unsafe-inline' quill-plugin:`，`default-src 'none'`——sandbox iframe 只能加载本插件目录资源。

## Assumptions (temporary)

- 「编译后内容」= `manifest.json` + `main` 指向的产物（如 `dist/`）+ 静态资源（图片/字体/html/css/wasm），**不含** `src/`、`*.ts(x)`、`node_modules/`、`package*.json`、`tsconfig*`、`.git/`、sourcemap（除非显式 opt-in）。
- Zip 是新的主路径，文件夹选路径作为开发调试保留。
- Zip slip（路径穿越攻击）必须在解压时严格过滤。

## Open Questions

- [x] Q1 文件夹安装路径保留（开发调试用），compiled-only 校验**只对 zip 路径生效**。
- [x] Q2 黑名单 + 白名单后缀双查：硬拒 `src/`、`node_modules/`、`.git/`、`*.ts(x)`、`package*.json`、`tsconfig*`、`vite/webpack/rollup.config.*`、`.env*`、`.vscode/`、`.idea/`、`.DS_Store`、`Thumbs.db`；剩余文件后缀必须落在允许集 `html/js/mjs/css/svg/png/jpg/jpeg/gif/ico/woff/woff2/ttf/wasm` + `manifest.json` + `LICENSE` + `README.md`。
- [Q3] 源码文件被检出时：硬失败（拒绝安装）还是软警告（剔除该文件后继续）？
- [x] Q3 黑名单硬失败（拒绝安装、清理 staging、错误里列出违禁文件）；后缀不在白名单的文件软剔除（不拷贝、在结果里警告列出）。
- [x] Q4 (默认决策，不单独问) 防解压炸弹：总解压大小上限 100 MB、单文件上限 50 MB、文件数上限 1000。超出即硬失败。Zip slip（`..`、绝对路径、符号链接、Windows 盘符）硬失败。
- [x] Q5 (默认决策) sourcemap `*.map` 不在白名单后缀 → 自动软剔除，不单独加 opt-in 机制。

## Requirements

- 新增 Tauri command `install_plugin_zip(id, zip_path)`：解压 → manifest 校验 → compiled-only 过滤 → 拷到 `~/.quill/plugins/<id>/` → 算 integrity → 写 `plugins.json` → 发 `plugin://installed`。失败即清理 staging 目录。
- 新增前端 store action `installFromZip(file)` + 「Install from .zip…」按钮（dialog `open({filters:[{extensions:['zip']}]})`）。
- Compiled-only 校验仅对 zip 路径生效；文件夹安装路径保持现状（开发调试用）。
- 防解压炸弹：总解压大小 ≤ 100 MB、单文件 ≤ 50 MB、文件数 ≤ 1000。
- 防 zip slip：拒绝 `..`、绝对路径、符号链接 entry、Windows 盘符前缀。
- 同 id 重装：跟现状 `copy_dir_recursive` 一致——先删后建、`upsert_record` 覆盖 entry（不保留 `trusted`，需重新 approve）。

## Acceptance Criteria

- [ ] Plugins 设置里点「Install from .zip…」选 zip 文件，安装成功后出现在列表里，sandbox 能加载 `html`，trusted 能 `import()` `main`。
- [ ] zip 含 `src/index.ts`、`node_modules/react.js`、`tsconfig.json`、`package.json` 等黑名单文件 → 安装失败、错误列出违禁文件、目标目录无残留。
- [ ] zip 含 `data.bin`（后缀不在白名单）→ 安装继续，`data.bin` 未拷贝，结果中警告列出。
- [ ] zip 含 `../escape.txt` 或符号链接 entry → 安装失败、目标目录无残留。
- [ ] zip 解压后总大小 / 单文件 / 文件数超上限 → 安装失败、staging 清理。
- [ ] 文件夹安装路径行为不变（保留旧入口，旧插件不破坏）。
- [ ] `cargo test` 覆盖：zip slip 拒绝、黑名单硬失败、白名单后缀软剔除、大小上限。

## Technical Approach

**Rust 端**（`plugin_commands.rs`）：
- 新增 `zip = "2"` 依赖。
- `install_plugin_zip(app, id, zip_path)`：在 `~/.quill/plugins/.staging/<id>-<uuid>/` 解压；逐 entry 校验路径（zip slip）+ 大小；按规则分流（拒绝 / 软剔除 / 拷入）；解压完读 `manifest.json`、`validate_manifest`、`id` 比对；通过后 `remove_dir_all` 旧目录（若存在）+ rename staging → `~/.quill/plugins/<id>/`；`compute_integrity` + `upsert_record` + `write_plugins_json` + `emit("plugin://installed")`。
- 复用：`validate_manifest`、`compute_integrity`、`upsert_record`、`write_plugins_json`、`plugins_dir`。
- 黑名单判定函数 `is_blacklisted(rel_path)` + 白名单后缀 `ALLOWED_EXTS`。违禁文件收集到 `Vec<String>` 一次性返回错误。

**前端**（`pluginStore.ts` + `PluginsSettings.tsx`）：
- `pluginStore.installFromZip(filePath)`：`id` 从 zip 文件名（去 `.zip`）推导，调 `invoke('install_plugin_zip', {id, zipPath: filePath})`。
- 「Install from .zip…」按钮：dialog `open({filters:[{extensions:['zip']}], multiple:false})`。

## Decision (ADR-lite)

**Context**: 现状 `install_plugin` 拷整目录、无源码过滤、无 zip；注释明确 zip 推到 PR4。
**Decision**: 新增 `install_plugin_zip` command + 前端入口；compiled-only 校验只走 zip；文件夹入口保持不变供开发调试。黑名单硬失败 + 后缀越界软剔除双查；大小上限防 zip bomb；同 id 重装沿用现状「删后重建」。
**Consequences**: 不破坏现有 `install_plugin` 语义；用户分发插件走 zip 路径、源码不进 plugins 目录。未来签名链上链时只需在 zip 安装流程加一层 `verify_plugin_signature` 强制校验。开发者调试时若想测「compiled-only 流程」需手动打 zip——可接受。

## Definition of Done

- 单测覆盖：zip 解压 + slip 拒绝 + 黑名单硬失败 + 后缀越界软剔除 + 大小上限。
- Lint / typecheck / `cargo test` 全绿。
- `docs/plugin-development.md` 打包说明更新（产物形态、禁带文件清单、白名单后缀）。
- 回滚路径：旧 `install_plugin` 接口语义不破坏已装插件；zip 路径是新加 command。

## Out of Scope

- 在线 marketplace / URL 下载安装。
- 签名链强制（ed25519 仍可选）。
- 增量更新 / 差分包 / 版本号冲突检测。
- 自动构建产物（用户自己 build）。
- 文件夹路径加 compiled-only 校验。

## Technical Notes

- 新增 Cargo dep：`zip = "2"`。
- Tauri dialog 已支持文件选择，无新插件。
- Staging 目录 `~/.quill/plugins/.staging/`，安装失败时 `fs::remove_dir_all`。
- Zip slip 防护点：(a) entry 名含 `..` 段；(b) 绝对路径（Unix `/` 起首、Windows `C:\` / `C:/`）；(c) symlink entry（`zip` crate 的 `ZipFile::enclosed_name()` 可用，但显式检查更稳）。
- 大小上限检查：累计已解压字节数 + 当前 entry 声明的 `uncompressed_size`，超限即 abort。
