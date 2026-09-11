# Rich-text Migration Phase 2: Extension Scaffold

> Parent: [`09-11-migrate-rich-text-type-to-extension`](../09-11-migrate-rich-text-type-to-extension/prd.md)
> Depends on: [`09-11-rt-phase1-sdk`](../09-11-rt-phase1-sdk/prd.md) ✅ merged

## Goal

建立 `extensions/rich-text/` 包骨架（mirror `extensions/dbml/`），用一个**空 handler** 验证扩展加载链路：desktop app 启动时通过 trusted-tier `import()` 加载扩展、注册一个最小 `rich-text` provider、能被 `getHandlerById('rich-text')` 查到、能开 `.richtext` 文件（不渲染内容，只占位）。Phase 3 才搬真组件。

## Requirements

### 包脚手架（mirror `extensions/dbml/`）

- `extensions/rich-text/package.json`：
  - `name: "@folyn/extension-rich-text"`, `version: "0.1.0"`, `private: true`, `type: "module"`
  - `scripts`: `build`, `typecheck`（同 dbml）
  - `dependencies`: `folyn-extension-sdk: workspace:*`（仅占位；Phase 3 加 `@tiptap/*`）
  - `devDependencies`: 同 dbml 的构建工具链（`esbuild`, `vite`, `@vitejs/plugin-react`, `react`, `react-dom`, `typescript`, `tailwindcss`, `autoprefixer`, `@types/react`, `@types/react-dom`）
- `extensions/rich-text/tsconfig.json`、`vite.config.ts`、`build.mjs`、`tailwind.config.js`、`postcss.config.js`、`.gitignore` — 拷贝自 dbml（按需调入口路径）

### manifest + 入口

- `extensions/rich-text/src/manifest.json`：
  - `id: "folyn-rich-text"`, `name: "Rich Text"`, `version: "0.1.0"`, `author: "Folyn"`, `folyn: ">=0.1.0"`, `tier: "trusted"`, `main: "dist/index.js"`
  - `permissions`: 全 false（占位，Phase 3 按需开 `vault.read`/`fs`）
  - `contributes.fileTypes: [{ id: "rich-text", handler: "rich-text", extensions: ["richtext"], defaultViewMode: "edit", supportedViewModes: ["edit"] }]`
  - `contributes.fileTemplates: [{ id: "rich-text-new", label: "Rich Text", fileName: "untitled.richtext", template: "{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\"}]}" }]`
- `extensions/rich-text/src/index.tsx`：
  ```tsx
  import type { ExtensionModule, FileTypeProvider, ExtensionApi, ExtensionContext } from 'folyn-extension-sdk';
  import { setApi, setExtensionId } from './api';

  // Phase 2: stub component. Phase 3 replaces with RichTextEditor.
  function StubEditor() {
    return <div className="p-4 text-t2">rich-text extension loaded (stub)</div>;
  }

  const provider: FileTypeProvider = {
    id: 'rich-text',
    extensions: ['richtext'],
    needsFileContent: true,
    defaultMode: 'edit',
    modes: [{ id: 'edit', kind: 'component', component: StubEditor }],
  };

  const module: ExtensionModule = {
    handlers: { 'rich-text': provider },
    activate(api: ExtensionApi, ctx: ExtensionContext) {
      setApi(api);
      setExtensionId(ctx.extensionId);
    },
  };

  export default module;
  ```
- `extensions/rich-text/src/api.ts` — 拷贝自 `extensions/dbml/src/api.ts`（setApi/getApi/setExtensionId/getExtensionId）
- `extensions/rich-text/src/react-shim.js` + `react-jsx-runtime-shim.js` + `svg.d.ts` — 拷贝自 dbml（trusted tier 与 host 共享 React 的 shim）

### Host 侧接线

- **无 discovery 入口可改**：dbml 扩展并不是 builtin trusted extension — 它通过 "Plugins → Install from folder…" 手动安装 `dist/` 到 `~/.folyn/extensions/<id>/`。rich-text 同理：build 出 `dist/` 后由用户/验收者手动安装 + TOFU approve。Phase 2 不改 host discovery。
- 从 `apps/desktop/src/components/sidebar/ContextMenu.tsx` 的 `NEW_FILE_GROUPS`（line 47）删除 `'rich-text'` 硬编码 —— builtin rich-text handler 落入动态 `extras` 组（"extensions" group）与扩展模板并列。**保留 `fileTypeLabelKeys['rich-text']`**（line 42），label 解析与所在 group 无关。
- **关键决策（registry overwrite 发现）**：`OwnedRegistry.register` 用 `byId.set(id, ...)` —— 同 id 注册是 last-writer-wins，不是 priority-coexist。扩展 activate 晚于 builtin → 扩展的 `rich-text` handler 会**覆盖** builtin（不是被 priority 压住）。因此 **Phase 2 manifest 不声明 `contributes.fileTypes`** —— `registerExtensionFileTypes` 对空数组 early-return，扩展不注册 handler，builtin 保持权威。`index.tsx` 的 `handlers: { 'rich-text': provider }` 是 dead code，Phase 3 加回 manifest 的 `contributes.fileTypes` 时激活。
- 从 `apps/desktop/src/components/file-types/registry.ts` 的 `import.meta.glob` 排除 rich-text —— **Phase 2 不删 builtin rich-text**。Phase 3 才删 builtin + 删 `@tiptap/*`。

### pnpm-workspace 注册

- `pnpm-workspace.yaml` 已包含 `extensions/*`（dbml 已在），无需改

## Acceptance Criteria

- [x] `extensions/rich-text/` 目录结构 + 配置文件齐全（package.json / tsconfig.json / build.mjs / .gitignore / src/manifest.json / src/index.tsx / src/api.ts / src/react-shim.js / src/react-jsx-runtime-shim.js / src/svg.d.ts）。**省略 vite.config.ts / tailwind.config.js / postcss.config.js** —— stub 不需要（host CSS 类 `p-4 text-t2` 直接由 host stylesheet 解释）；Phase 3 搬 RichTextEditor 时再加。
- [x] `pnpm install` 成功（新包被 workspace 识别）
- [x] `pnpm --filter @folyn/extension-rich-text build` 产出 `dist/index.js` + `dist/manifest.json`
- [x] `pnpm --filter @folyn/extension-rich-text typecheck` 通过
- [ ] desktop app 启动后手动安装 `extensions/rich-text/dist/` 到 Folyn → Plugins → Install from folder… → TOFU approve，console 日志显示 `folyn-rich-text` activate
- [ ] 命令面板出现 "New Rich Text"，执行后弹出保存对话框，默认文件名 `untitled.richtext`，内容为空 doc JSON
- [ ] 右键新建子菜单的动态 `extras` 组出现 "Rich Text"（builtin handler 落入动态组，label "Rich Text" 由 `fileTypeLabelKeys['rich-text']` 解析）
- [ ] builtin rich-text 仍可编辑（打开 `.richtext` 文件 → RichTextEditor 正常显示，扩展不接管）—— 验证 Path (B) 不回归
- [ ] dbml 扩展回归通过（打开 `.dbml` 文件正常）

## Definition of Done

- lint / typecheck / build green
- dbml 扩展回归通过
- builtin rich-text 保留可编辑（Phase 2 不切换，Phase 3 才切）

## Out of Scope

- 搬 RichTextEditor 等真组件（Phase 3）
- 删除 builtin rich-text handler（Phase 3）
- 删除 `@tiptap/*` desktop 依赖（Phase 3）
- 实现图片持久化 / 表格 / 数学公式（Phase 3 搬迁 + Phase 4 验证）
- `ImagePasteDialog` / `TableConvertDialog` 拷贝（Phase 3）

## Technical Notes

### 关键参考文件
- `extensions/dbml/package.json` / `vite.config.ts` / `build.mjs` / `tsconfig.json` / `tailwind.config.js` / `postcss.config.js` / `.gitignore`
- `extensions/dbml/src/index.tsx` — 入口模式
- `extensions/dbml/src/api.ts` — setApi/getApi shim
- `extensions/dbml/src/manifest.json` — manifest 结构
- `extensions/dbml/src/react-shim.js` / `react-jsx-runtime-shim.js` / `svg.d.ts` — trusted-tier React 共享 shim
- `apps/desktop/src/services/extension-host/trustedLoader.ts` — trusted 加载器
- `apps/desktop/src/services/extension-host/extensionDiscovery.ts`（待确认 discovery 入口位置）
- `apps/desktop/src/components/file-types/registry.ts` — builtin glob 注册
- `apps/desktop/src/components/sidebar/ContextMenu.tsx:42,47,99-115` — 硬编码删除点 + 动态扩展组机制

### Phase 2 vs Phase 3 边界
Phase 2 验证「扩展能加载 + manifest 能声明 + 命令面板/右键新建能出现」。StubEditor 的渲染验证（`.richtext` 路由到 stub）**不在 Phase 2** —— registry overwrite 语义意味着只要扩展注册 handler 就会覆盖 builtin，与 "不回归" 目标冲突。StubEditor 在 Phase 3 自然渲染：Phase 3 给 manifest 加回 `contributes.fileTypes` + 删 builtin → 扩展接管，StubEditor 被替换为 RichTextEditor 前可短暂渲染验证。

### Registry overwrite 发现（Path B 决策依据）
`packages/extension-sdk/src/registry.ts:46` `OwnedRegistry.register` 用 `this.byId.set(id, ...)` —— 同 id 后注册者覆盖前注册者。`HandlerRegistry` 的 `extMap` 只存 handler id（不区分多个同 id 的注册），`listProviders` 的 priority 排序**只对同扩展、不同 id 的多个 handler 生效**。所以 priority 无法让 builtin 与扩展的同 id handler 共存。Path (B)：Phase 2 manifest 不声明 `contributes.fileTypes`，扩展的 `rich-text` handler 不注册，builtin 保持权威。
