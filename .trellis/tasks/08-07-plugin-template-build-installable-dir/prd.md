# Plugin template: build → installable dir

## Goal

让 `create-quill-plugin` 模板的 `build.mjs` 产出一个**可直接选目录安装**的结果目录——`dist/` 内含 `manifest.json` + built bundle（+ 静态资源），用户在 Plugins 设置里选 `dist/` 文件夹就能装，不混入源码 / 配置 / node_modules。

**Why**: 现状 `build.mjs` 只产 `dist/index.js`，`manifest.json` 留在模板根。用户要装，要么选模板根目录（混入 `src/`、`package.json`、`tsconfig.json`，虽然文件夹路径不强制 compiled-only，但脏），要么手动打包 zip。改 build 脚本把 `dist/` 变成自包含的可装目录，是最低成本路径。

## What I already know

- 模板路径：`packages/create-quill-plugin/template/`。
- `build.mjs`：esbuild `src/index.ts` → `dist/index.js`，bundle 自包含（React 走 `window.React`，external 为空）。
- `manifest.json` 在模板根，`main: "dist/index.js"`（相对 manifest 位置）。
- 安装侧（刚做完的 PR4）：文件夹安装路径不强制 compiled-only（开发调试用），zip 路径强制。`install_plugin` 校验 manifest、拷目录、算 integrity。
- `.gitignore` 已忽略 `dist/`，所以 `dist/` 是构建产物，不进 git。
- `README.md` 现有 "Develop" 段落，需补「安装结果目录」说明。

## Assumptions (temporary)

- 结果目录名：`dist/`（已有目录，不另起名）。
- `manifest.json` 在 `dist/` 内的 `main` 应是 `index.js`（相对 dist 根），而非 `dist/index.js`。
- 静态资源：模板当前无 `assets/` 之类的目录，build 脚本不做资源拷贝逻辑（YAGNI；用户加资源时自行 copy 或后续按需扩展）。

## Open Questions

- [Q1] 根 `manifest.json` 的 `main` 留 `"dist/index.js"`（开发选根目录仍能装）还是改成 `"index.js"`（强制只能装 dist/）？

## Requirements (evolving)

- `build.mjs` 在 esbuild 完成后，把 `manifest.json` 拷进 `dist/manifest.json`，并把 `main` 字段从 `"dist/index.js"` 改写为 `"index.js"`（相对 dist 根）。
- `dist/` 即为可直接选目录安装的结果目录。
- README 补「Build → Install」段落，说明 `pnpm build` 后在 Plugins 设置选 `dist/` 文件夹。

## Acceptance Criteria (evolving)

- [ ] `pnpm build` 后 `dist/` 内含 `manifest.json` + `index.js`，且 `manifest.json` 的 `main` 是 `"index.js"`。
- [ ] 在 Plugins 设置选 `dist/` 文件夹能装成功，sandbox / trusted 都能加载（trusted 走 `import()`）。
- [ ] `dist/` 不含 `src/`、`package.json`、`tsconfig.json`、`node_modules/`。
- [ ] 根 `manifest.json` 行为按 Q1 决策确定。
- [ ] `create-quill-plugin` 脚手架后 `pnpm install && pnpm build` 即可产出可装目录。

## Definition of Done

- 单测/集成验证：脚手架一个临时插件 → `pnpm build` → 检查 `dist/` 内容 + manifest `main` 字段。
- `pnpm --filter create-quill-plugin test`（若脚手架有 test harness）绿。
- README 段落更新。
- 回滚：根 `manifest.json` 不动（除非 Q1 选 B），旧使用方式不破坏。

## Out of Scope

- 模板加 `assets/` 目录或资源拷贝逻辑（YAGNI）。
- 改 `create-quill-plugin` CLI 本身（只改 `template/`）。
- zip 打包脚本（zip 路径已有，用户手动 `zip -r`）。
- 多入口 / 多 chunk（esbuild 现单入口，足够）。

## Technical Notes

- `build.mjs` 用 `node:fs/promises` 的 `readFile`/`writeFile`/`mkdir`，不引新依赖。
- 改写 `main`：`manifest.main.replace(/^dist\//, '')` 一行——若 `main` 是 `"dist/index.js"` → `"index.js"`；若已是 `"index.js"` 不变。这样脚手架的根 manifest 仍可写 `"dist/index.js"`（开发选根目录装）或 `"index.js"`，build 都能产对的 dist manifest。
- `dist/` 已被 `.gitignore`，无需改 ignore。
- 不动 `tsconfig.json`（`noEmit: true`，typecheck only）。
- 不动 `package.json` scripts（`build` 仍是 `node build.mjs`）。
