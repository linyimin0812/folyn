# harden html preview sandbox

## Goal

修复 `HtmlPreview.tsx` 的沙箱安全洞：`sandbox="allow-scripts allow-same-origin"` 渲染任意
vault HTML（`.html/.htm` 文件的 Preview），组合等于没沙箱——iframe 内 `<script>` 能访问
`parent.window.__TAURI__` 调 Tauri 命令、读 localStorage，构成提权。改为 `allow-scripts` only，
把原本靠 same-origin 访问 parent-DOM 做的合法操作（主题注入、锚点导航）改成注入进 srcDoc 内容本身。

## What I already know

### 漏洞现状（`apps/desktop/src/components/file-types/html/HtmlPreview.tsx`）

- `sandbox="allow-scripts allow-same-origin"` + `srcDoc={content}`（content = vault 里任意 .html 文件内容）。
- `onLoad` 里两处依赖 same-origin 访问 `iframe.contentDocument`：
  1. 注入 `<style>` 强制 `color-scheme:light` + 白底（iframe 继承 parent 暗色主题，否则透明 SVG 区变暗）。
  2. 拦截 `<a>` 点击：preventDefault，`#hash` 走 `scrollIntoView` 做文档内导航；非 `#` 的 href preventDefault 后什么都不做（**外部链接今天就是死的**）。

### 正面教材

- `apps/desktop/src/services/plugin-host/sandboxLoader.ts:81` — `sandbox="allow-scripts"`（无 same-origin）→ opaque origin，postMessage 是唯一桥接。
- `apps/desktop/src/components/sidebar/AnalysisPanel.tsx:391` — `sandbox=""`（无脚本，受信 dashboard 嵌入）。

### 关键洞察

`onLoad` 的两个 same-origin 操作**都不需要访问 parent**——它们操作的是 iframe 自己的 document。
把那段逻辑注入进 srcDoc 内容本身（一个 `<style>` + 一个 `<script>`），iframe 保持 `allow-scripts` only：
内部脚本访问自己的 document 合法（同 origin 于自己），碰不到 parent。**无需 postMessage 桥接**。

## Assumptions (temporary, to validate)

- 外部链接（非 `#hash`）今天就是死的（preventDefault + 无操作），不作为本任务回归项。
- Markdown 预览的 raw HTML 注入是另一个威胁面（rehype sanitize），不在本任务范围。
- `HtmlVisualEditor`（GrapesJS Editor）在主 realm 编辑，不本任务范围。

## Open Questions

- （已收敛）外部链接保持死链，行为零变化。

## Requirements

- iframe `sandbox="allow-scripts"` only（删 `allow-same-origin`）。
- 原 `onLoad` 的 parent-DOM 逻辑迁移到注入 srcDoc 的内容：
  - `<style>`：`html,body{color-scheme:light !important;background:#fff !important}`。
  - `<script>`：文档内 `<a>` 点击 → preventDefault；`#hash` 走 `scrollIntoView` 文档内导航；非 `#` 无操作（保持今天死链行为）。
- 注入用独立小函数（DOMParser 解析 → 插 `<head>`/`</body>` → 序列化），解析不执行脚本，安全。
- fragment HTML（无 head/body）也要正确处理（DOMParser 归一化为完整文档）。
- 不复用 `grapesContentPipeline`（GrapesJS 专属，耦合不划算）。

## Acceptance Criteria

- [ ] `HtmlPreview.tsx` iframe `sandbox` 不含 `allow-same-origin`。
- [ ] vault HTML 含 `<script>` 时，脚本无法访问 `parent.window.__TAURI__` / parent localStorage（测试验证：注入试图读 `parent` 的脚本，断言 cross-origin 拿不到）。
- [ ] light 主题注入仍生效（暗色主题下预览仍白底）。
- [ ] `#hash` 锚点点击仍在文档内滚动导航。
- [ ] 非 `#` 外部链接点击仍 preventDefault + 无操作（行为零回归）。
- [ ] 现有 html 测试绿 + 新增沙箱测试。

## Definition of Done

- 沙箱测试覆盖（提权尝试失败 + 功能不回归）。
- lint / typecheck / build / test 绿。
- 行为零变化，无需用户侧文档。

## Out of Scope (explicit)

- 外部链接打开（保持死链；若需另开任务）。
- Markdown raw HTML sanitize。
- `HtmlVisualEditor`/GrapesJS 沙箱化。
- postMessage RPC 桥接（本方案不需要）。

## Decision (ADR-lite)

**Context**: `HtmlPreview` 用 `allow-scripts allow-same-origin` 渲染任意 vault HTML，
iframe 脚本可访问 `parent.__TAURI__` 提权。但 `onLoad` 的两个合法操作（主题注入、
锚点导航）操作的是 iframe 自己的 document，不需要 parent 访问。

**Decision**: Approach A（内容注入）。删 `allow-same-origin`，DOMParser 解析 content →
注入 `<style>`+`<script>` → 序列化为 srcDoc，iframe `allow-scripts` only。外部链接
保持死链（不本任务加功能）。不引入 postMessage 桥接（Approach B 过度工程）。

**Consequences**: 多一次 DOMParser 解析（预览一次性，可接受）；需稳健注入
fragment/full-doc；行为零回归。

## Research Notes

### 可行方案

**Approach A — 内容注入（推荐）**
删 `allow-same-origin`，DOMParser 解析 content → 注入 `<style>`（light 主题）+ `<script>`（锚点导航）→ 序列化为 srcDoc。iframe `allow-scripts` only。
- Pros: 最小改动，无桥接复杂度，两合法功能完整保留，提权洞堵死。
- Cons: 要稳健注入任意 HTML（fragment/full-doc 都要处理）；多一次 DOMParser 解析（可接受，预览本就一次性）。

**Approach B — 完整 postMessage RPC 桥接（仿 plugin-host）**
保持 `allow-scripts` only，主题/链接通过 postMessage 桥接到 parent 执行。
- Pros: 通用、可扩展（未来外部链接打开、双向通信）。
- Cons: 对 Preview 的两个简单需求严重过度工程；引入 origin 校验/capability 基础设施。

**Approach C — 删 `allow-same-origin` 但保留 parent onLoad 注入**
不可行：无 same-origin 时 `iframe.contentDocument` 为 null，onLoad 的 DOM 操作直接失效。

## Technical Notes

- 文件：`apps/desktop/src/components/file-types/html/HtmlPreview.tsx`（34 行）。
- 注册：`file-types/html/index.ts`，`extensions: ['html','htm']`，Preview = HtmlPreview。
- 复用参考（不复用）：`grapesContentPipeline.ts` 的 `parseHtmlForGrapes`（DOMParser 模式）。
- 沙箱正面教材：`sandboxLoader.ts`、`AnalysisPanel.tsx:391`。
