# npx 命令创建 plugin 模板

## 目标

提供 `npx create-quill-plugin <name>` 一键拉起符合规范的 plugin 骨架。

## 范围

- 新增独立包 `packages/create-quill-plugin`（npm `create-quill-plugin`），含 `bin`
- 模板来源：`plugins/quill-plugin-plantuml` 现有结构（package.json / manifest.json / src/index.ts / src/react.ts / tsconfig.json / build.mjs / README）
- 运行流程：`<name>` → 创建同名目录 → 复制模板 → 替换占位符（id/name/package name）→ 打印下一步提示
- 不接 CLI 交互式向导（YAGNI），只接位置参数；后续再加 prompt
- 模板内容是「最小可构建」的空 handler，不含 plantuml 业务逻辑

## 非目标

- 不集成进 `quill-plugin-sdk`（SDK 保持 runtime-free）
- 不支持 monorepo workspace 注入（让用户后续手动加，保持工具独立）
- 不发布到 npm（先本地可用，发布是后续任务）

## 验收

- `npx ./packages/create-quill-plugin my-plugin` 在当前目录生成 `my-plugin/`
- 生成的目录 `pnpm install && pnpm build` 能产出 `dist/index.js`
- 模板内 `manifest.json` 的 id 和 package.json 的 name 都来自 `<name>`
