# Allow toast CDN in CSP

## Context
`grapesjs-tui-image-editor` 在用户打开图片编辑器时从 `https://uicdn.toast.com/tui-image-editor/v3.15.2/` 运行时加载 JS + CSS。当前 `apps/desktop/src/utils/csp.ts` 的 `BASE_DIRECTIVES.script-src` / `style-src` 不包含该域，Tauri webview 报 CSP 拒绝（`[Error] Refused to load https://uicdn.toast.com/...tui-image-editor.min.js`，x6）。

## Decision
把 `https://uicdn.toast.com` 加入 `BASE_DIRECTIVES` 的 `script-src` 和 `style-src` 基线源。与 Qiniu / R2 / OSS 一样作为基线允许域（非用户可编辑项），理由：grapesjs-tui-image-editor 是 Quill 打包时绑定的内置插件，其依赖属于 app 自身依赖，不是用户可配的运行时源。

## Out of scope
- 本地化 tui-image-editor（npm 安装 + patch 插件 CDN 指向）—— 彻底去 CDN 的方案，留待后续若性能/隐私需求再考虑。
- `img-src` / `font-src` —— tui-image-editor 自带图标多走 data:，不强制；若实测仍被 CSP 拦，再补。

## Acceptance
打开 HTML 编辑器 → 图片组件 → 调用图片编辑器，控制台不再出现 `Refused to load https://uicdn.toast.com/...` 的 CSP 错误，编辑器弹窗正常加载。
