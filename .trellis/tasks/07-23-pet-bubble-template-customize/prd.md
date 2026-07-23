# Pet Bubble Template Customize

## Goal

让用户能够自定义桌宠弹窗（pet-bubble）的样式与结构：上传 HTML+CSS 模板，运行时用 HTTP 透传的 payload 字段填充占位符后渲染。在现有 HTTP `POST /pet/action` 触发链路上叠加模板化能力，并内置 4 套预设样式。

## What I already know

- HTTP 触发链路已打通：`pet_api/mod.rs` → `dispatch::route_action` → `build_notify` → `app.emit("pet://notify", payload)` → `usePetHostBridge.ts:164` 监听 → `petNotifyDispatcher` 按设置分流到 bubble / OS。
- 弹窗窗口 `#/pet-bubble`，根组件 `PetBubbleApp.tsx:203-239`，固定 JSX 结构：`.pet-bubble-root > .pet-bubble-card > [close] [title?] [text] [actions?]`，TTL 6s。
- 样式固定在 `pet.css:512-628`，`.pet-bubble-card` 左色条 + 白底，`.pet-bubble--info|reminder|message|event` 染色。
- HTTP 当前只透传 `text/kind/title/target`（`dispatch.rs:80-109`）。`source` 和 `actions` 字段已在前端类型里定义但 HTTP 端不构造。
- 设置存储：`settings:all` blob → `appDataDir/storage.json`，pet slice 在 `petStore.ts` 注册 `PERSIST_KEYS_PET`，含 `notificationForm: 'bubble'|'system'|'both'|'off'`。
- 现有 Tauri 窗口：`pet-bubble` 320×120 transparent、shadow:true。

## Assumptions (temporary)

- 模板语法用极简自定义 `{{field}}` token 替换，不引入 handlebars/mustache 依赖（ponytail: 20 行可写）。
- HTML 用 `DOMPurify` + `dangerouslySetInnerHTML` 注入，CSS 用 `<style>` 标签注入到 bubble 文档。
- 模板以 JSON 形式存储在 `petStore.bubbleTemplates` 数组，激活模板用 `activeTemplateId`。默认激活内置 `default` 模板（即现状样式）。
- 用户上传方式：文件选择器（`.json`）+ 文本框粘贴。不做可视化编辑器（L3，out of scope）。
- HTTP 请求体可带可选 `template: "glass"` 字段，指定本次通知用某套模板，未传则走全局 `activeTemplateId`。
- payload 所有标量字段在替换前先 HTML-escape，防用户 data 破坏模板结构 / XSS。
- bubble 窗口注入 `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:">`。
- 新增「打开外部应用」能力：顶层 `launch` + `actions[].launch` 两种挂载点；`type: "url"` 仅校验 http/https 协议直接打开；`type: "app"` 走用户维护的 app 名白名单，不在白名单时 bubble 显示「未授权，点此允许」，用户批准后写入白名单并执行。

## Open Questions

- 边缘场景与失败处理策略（见下方 expansion sweep，待用户确认）

## Requirements

### 功能性

- 用户可在设置页 PetSettings 看到"弹窗样式"分区，列出所有可用模板（内置 + 自定义）。
- 用户可激活某个模板，激活后所有 HTTP 触发的 bubble 用该模板渲染。
- 用户可导入模板：文件 `.json` + 粘贴文本两种入口。
- 用户可删除自定义模板（内置模板不可删，可恢复默认）。
- 设置页提供"预览"按钮，用示例 payload 触发一次 bubble 渲染（不发送 OS 通知）。
- 模板支持占位符：`{{title}}` `{{text}}` `{{kind}}` `{{source}}` `{{target.kind}}` `{{target.id}}` `{{data.*}}` `{{#actions}}...{{/actions}}` 块级循环（最多 2 个 button）。
- HTTP 透传扩展：`POST /pet/action` 请求体新增 `data: object`（任意键值）、`source: string`、`template: string`（可选，指定本次用某套模板 id）字段，透传到 `pet://notify` payload。
- 打开外部应用能力：
  - payload 顶层 `launch: { type: "url"|"app", value: string }` 和 `actions[].launch` 均支持。
  - `type: "url"`：`value` 必须 `http:`/`https:` 协议，直接走 `open <url>`（默认浏览器）。无白名单。
  - `type: "app"`：`value` 为 macOS app 名（如 `Terminal`/`Xcode`）。查询 `petStore.bubbleAppWhitelist`：在名单 → `open -a "<name>"`；不在名单 → bubble 渲染未授权态，提供「允许本次」/「允许并加入白名单」按钮，用户批准后写入白名单再执行。
  - 设置页 PetSettings 增加「外部应用白名单」分区：list + add/remove，用户可手动维护。

### 非功能性

- XSS 防护双层：
  - L1：tokenizer 在标量替换前对所有 payload 值做 HTML-escape（`&` `<` `>` `"` `'`）。
  - L2：渲染后 `DOMPurify.sanitize(html, {FORBID_TAGS:['script','style','link','iframe','object','embed'], FORBID_ATTR:['on*']})`。
  - L3：bubble 窗口注入 CSP `<meta>` 限制资源加载，禁远程 img/font/@import。
- 模板加载失败（JSON 不合法 / 缺字段 / id 冲突）时回退到内置 `default`，不阻塞通知。
- 模板单文件大小上限 64KB（与现有 `MAX_BODY_BYTES` 一致）。
- 模板 id 冲突（用户导入的 id 与内置相同）：拒绝导入并提示。
- launch 字段安全约束：
  - `launch.type` 必须是 `"url"` 或 `"app"`，否则忽略（不执行）。
  - `launch.value` ≤ 512 字符，URL 必须以 `http://` 或 `https://` 开头；app 名仅允许字母数字空格点连字符（防 shell 注入），不允许路径分隔符。
  - `open -a` 的 app 名由 Rust 端传参时强制用 `Command::new("open").arg("-a").arg(name)`，依赖 std::process::Command 的参数分隔（不走 shell），避免 shell 注入。
  - 非白名单 app 不自动执行；必须用户在 bubble 上主动点击「允许」才授权。

## Acceptance Criteria

- [ ] PetSettings 新增"弹窗样式"分区，展示模板列表 + 激活态 + 导入/删除/预览操作。
- [ ] 内置 4 套预设模板：`default`（现状白卡）、`glass`（玻璃拟态）、`dark`（暗夜）、`minimal`（极简 toast）、`colorful`（彩色卡片）。
- [ ] HTTP `POST /pet/action` 支持 `data`、`source`、`template`、`launch` 字段透传。
- [ ] 模板占位符渲染：`{{title}}` `{{text}}` `{{kind}}` `{{source}}` `{{data.x}}` `{{#actions}}<button data-action="{{id}}">{{label}}</button>{{/actions}}`。
- [ ] HTTP 请求带 `template: "glass"` 时本次 bubble 用 glass 模板渲染；未传走 `activeTemplateId`；模板 id 不存在走 `default`。
- [ ] payload 标量值在替换前 HTML-escape。
- [ ] 模板 HTML 经 DOMPurify 清洗（禁 script/style/link/iframe/object/embed，禁 on* 属性）。
- [ ] bubble 窗口 HTML 注入 CSP `<meta>`：`default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:`。
- [ ] 导入非法模板 / id 冲突时提示错误并回退到当前激活模板。
- [ ] 预览按钮触发一次 `pet://bubble-show` 用示例 payload 渲染。
- [ ] launch.type="url" + http(s) URL → 点击 bubble（或对应 action button）→ 默认浏览器打开。
- [ ] launch.type="app" + 在白名单 → 点击后执行 `open -a <name>`。
- [ ] launch.type="app" + 不在白名单 → bubble 显示未授权态 + 「允许本次」/「允许并加入白名单」按钮；用户点击后写入白名单并执行。
- [ ] launch.type 非法 / value 超 512 字符 / URL 非 http(s) / app 名含路径分隔符 → Rust 拒绝并忽略 launch（仍正常显示通知）。
- [ ] PetSettings 新增「外部应用白名单」分区：list + add/remove，持久化到 petStore。
- [ ] 单测：模板 tokenizer、占位符替换、HTML-escape、DOMPurify 清洗、Rust 端 `build_notify` 新字段校验、`template` 字段优先级、launch 字段校验（url 协议、app 名禁用字符）、白名单查询。
- [ ] 现有 `default` 模板渲染结果与改动前像素级一致（回归）。

## Definition of Done

- 单测覆盖：模板 tokenizer、占位符替换、sanitize、dispatch 新字段。
- `pnpm typecheck` / `pnpm test` / `cargo test` 全绿。
- PetSettings 页面在 light/dark 主题下布局正常。
- 手动验证：HTTP 触发通知用 4 套模板各跑一遍。

## Out of Scope

- 可视化模板编辑器（L3）。
- 模板分享市场 / 在线下载。
- 模板版本管理 / 多版本迁移。
- 非浏览器/CSS 能力外的动效（Lottie/Rive 等）。
- OS 通知样式自定义（仅 bubble 窗口）。
- launch.type="file"（打开本地文件）与 shell 命令执行（L3 安全风险）。
- launch.type="app" 在白名单外的批量授权 / 全局允许所有 app（永远需要逐个授权）。

## Technical Approach

### 模板格式

```json
{
  "id": "glass",
  "name": "玻璃拟态",
  "html": "<div class=\"bubble\"><div class=\"title\">{{title}}</div><div class=\"text\">{{text}}</div><div class=\"actions\">{{#actions}}<button data-action=\"{{id}}\">{{label}}</button>{{/actions}}</div></div>",
  "css": ".bubble { background: rgba(255,255,255,0.6); backdrop-filter: blur(12px); border-radius: 14px; padding: 12px; } .bubble .title { font-weight: 600; } .bubble .text { color: #374151; }",
  "fields": ["title", "text", "actions"]
}
```

### 占位符语法（自定义极简 tokenizer）

- `{{key}}` — 标量替换，支持嵌套 `{{data.foo}}`、`{{target.kind}}`。
- `{{#actions}}...{{/actions}}` — 数组循环，块内用 `{{key}}` 取 item 字段。
- 不支持条件、不执行 JS、不支持 partial。20-30 行实现。
- 标量值替换前先 HTML-escape：`&` `<` `>` `"` `'` → 实体。

### 渲染流程

1. `PetBubbleApp` 收到 `pet://bubble-show` payload。
2. 读 `usePetStore.getState().bubbleTemplates` + `activeTemplateId`；若 `payload.template` 存在且匹配某 id 则优先用之，否则走 `activeTemplateId`，再否则回退 `default`。
3. 调用 `renderTemplate(template, payload)` → 标量 HTML-escape → `{{#actions}}` 块展开 → 字符串替换。
4. `DOMPurify.sanitize(html, {FORBID_TAGS:['script','style','link','iframe','object','embed'], FORBID_ATTR:['on*']})` → `dangerouslySetInnerHTML` 注入到 `.pet-bubble-root`。
5. `<style>{template.css}</style>` 注入到 `<head>`（bubble 窗口隔离，CSP `style-src 'unsafe-inline'` 放行）。
6. action button 用事件委托：`root.addEventListener('click', e => { const btn = e.target.closest('[data-action]'); ... emit('pet://bubble-action', {type:'action', actionId: btn.dataset.action}) })`。
7. bubble 窗口 HTML 已在入口注入 CSP `<meta>`（一次性）。

### 存储

- `petStore` 新增：`bubbleTemplates: BubbleTemplate[]`（默认含 5 套内置）、`activeTemplateId: string`（默认 `'default'`）。
- 加入 `PERSIST_KEYS_PET`：只持久化用户自定义模板 + active id（内置模板从代码常量注入，不持久化，便于升级）。

### Rust 端改动

- `dispatch.rs::build_notify` 增加透传字段：
  - `source: Option<String>`（≤128 字符）
  - `data: Option<Value>`（`serde_json::Value` 透传不解析）
  - `template: Option<String>`（非空，≤64 字符）
  - `launch: Option<LaunchSpec>`，其中 `LaunchSpec = { type: "url"|"app", value: String }`
- `MAX_BODY_BYTES` 保持 64KB；请求体超 → 413。
- 新增 Tauri 命令 `open_external(target: LaunchSpec)`：
  - `type == "url"`：校验 `value` 以 `http://`/`https://` 开头，`Command::new("open").arg(value)` 执行。
  - `type == "app"`：校验 `value` 仅含 `[A-Za-z0-9 .\-]` 且不含 `/` `\`，查前端传入的白名单（前端维护、调命令时一并传），在白名单 → `Command::new("open").arg("-a").arg(value)`；不在 → 返回 `Err("not_in_whitelist")` 让前端展示授权 UI。
  - 全程使用 `std::process::Command` 分隔参数，不走 shell，避免注入。

### 前端改动文件

- `apps/desktop/src/store/petStore.ts` — 新增 templates slice（`bubbleTemplates`、`activeTemplateId`）、`bubbleAppWhitelist: string[]`、相关 persist keys + hydrate。
- `apps/desktop/src/components/pet/PetBubbleApp.tsx` — 改为模板驱动渲染；处理顶层 `launch` 点击和 actions.launch 点击；未授权 app 的授权 UI 分支。
- `apps/desktop/src/components/pet/bubbleTemplate.ts`（新）— tokenizer + render + sanitize wrapper + 内置模板常量。
- `apps/desktop/src/components/pet/launchExternal.ts`（新）— `invoke('open_external', { target, whitelist })` 封装 + 未授权 → 弹授权 → 写白名单 → 重试。
- `apps/desktop/src/components/settings/PetSettings.tsx` — 新增"弹窗样式"分区 + "外部应用白名单"分区 UI。
- `apps/desktop/src/components/settings/BubbleTemplateEditor.tsx`（新，可选）— 粘贴/导入/预览的独立组件。
- `apps/desktop/src/components/settings/BubbleAppWhitelist.tsx`（新，可选）— 白名单 list+add+remove。
- `apps/desktop/src/types/petBubble.ts`（新或扩展）— `BubbleTemplate`、`LaunchSpec`、`PetBubblePayload.launch` 类型。

### 依赖新增

- `dompurify` + `@types/dompurify`（约 30KB gzip，含类型）。无其他新依赖。

## Decision (ADR-lite)

**Context**: 桌宠弹窗需要让用户自定义样式，同时 HTTP 触发已透传结构化字段，且用户希望弹窗能「打开外部应用」。
**Decision**: L2 HTML+CSS 模板 + 自定义极简占位符 tokenizer + 三层 XSS 防护（payload HTML-escape → DOMPurify 清洗 → bubble 窗口 CSP meta）+ 模板以 JSON 存于 petStore + HTTP 透传扩展 `data`/`source`/`template` 字段 + `launch` 字段支持打开 URL（无白名单）和 macOS app（用户白名单 + 逐项授权）。不引入 handlebars/mustache 依赖，不建可视化编辑器，不做模板导出、文件打开、shell 执行（L3 风险）。
**Consequences**: 
- (+) 最小依赖、最小 diff、用户可完全控制模板结构。
- (+) 三层防护降低 XSS 风险；模板里的远程资源被 CSP 拦截。
- (+) `template` 字段让一次 HTTP 请求可指定样式。
- (+) URL 直接打开 + app 白名单 + 逐项授权，把"任意进程 POST 一个启动命令"的风险压到「用户必须先同意」。
- (−) 用户需懂 HTML/CSS；满足"自定义"诉求但门槛略高。
- (−) tokenizer 需自测；循环语法受限（只支持数组 `{{#x}}...{{/x}}`，不支持条件）。
- (−) CSP 禁用远程 img 限制模板创意；用户可用 data: 内联资源绕开。
- (−) 白名单授权 UI 让 bubble 状态机更复杂（未授权/已授权/已执行/执行失败），需额外测试。

## Implementation Plan (small PRs)

- PR1（Rust + 类型透传）：`dispatch.rs::build_notify` 加 `data/source/template/launch`；新增 `open_external` 命令；前端 `PetBubblePayload` 类型扩展；现有行为回归不变。
- PR2（模板引擎 + 渲染）：`bubbleTemplate.ts` tokenizer + render + sanitize + 内置 5 套模板常量；`PetBubbleApp.tsx` 改模板驱动；CSP meta 注入。
- PR3（设置 UI + 存储）：`petStore` templates slice + 白名单 slice + 持久化；`PetSettings` 弹窗样式分区 + 白名单分区 + 导入/删除/预览。
- PR4（launch 行为 + 授权流）：`launchExternal.ts` 封装；bubble 顶层 click / actions.launch 事件路由；未授权 app 的授权 UI 分支 + 白名单写入 + 重试。
- PR5（测试 + 回归）：单测 tokenizer / escape / sanitize / dispatch 校验 / launch 校验 / 白名单；手动回归 5 套模板。

## Out of Scope

（同上）

## Technical Notes

- 已检视文件：
  - `apps/desktop/src-tauri/src/pet_api/{mod.rs,dispatch.rs}`
  - `apps/desktop/src/hooks/usePetHostBridge.ts:164`
  - `apps/desktop/src/services/petNotifyDispatcher.ts:129`
  - `apps/desktop/src/components/pet/PetBubbleApp.tsx:203`
  - `apps/desktop/src/components/pet/pet.css:512`
  - `apps/desktop/src/store/petStore.ts:28,119`
  - `apps/desktop/src/store/settingsPersistence.ts`
  - `apps/desktop/src/components/settings/PetSettings.tsx`
- 约束：bubble 窗口 320×120，模板内容超出会被 clip（透明窗口不滚动）。
- `tauri.conf.json` 已有 `pet-bubble` 窗口声明，不需改。
- HTTP 端口 `127.0.0.1:17382+`，无鉴权（本地）。
