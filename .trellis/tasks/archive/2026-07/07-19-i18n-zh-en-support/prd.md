# i18n zh en support

## Goal

为 Quill 提供 i18n 能力，先支持中文（zh）和英文（en）。覆盖 `apps/desktop` 前端 UI 文案；后续可扩展到 plugin-host / vault-provider 等包的对外文案。

## What I already know

- 技术栈：Tauri 2 + React + Vite + TypeScript，monorepo（pnpm）
- `apps/desktop/src` 下 399 个 ts/tsx 文件，UI 文案目前是裸中文字符串散落各组件（如 `SettingsPage.tsx`、`VaultPage.tsx`、`ActivityBar.tsx`）
- 现有 settings：`apps/desktop/src/store/appearanceStore.ts`、`apps/desktop/src/hooks/useTheme.ts`，已有持久化范式可参考
- 现有 appearanceStore 模式：zustand + persisted（localStorage），可复用做 locale 持久化
- 代码注释里大量中文 —— 注释不在 i18n 范围
- 目前没有任何 i18n 依赖

## Assumptions (temporary)

- 默认语言跟随系统 locale（`navigator.language`），用户可手动切换并持久化
- 切换语言后无需刷新页面（i18next 支持）
- 文案以 React 组件内为主，命令/工具栏标题、按钮、提示、空状态、错误 toast 都在范围内

## Open Questions

（已收敛）

## Requirements (evolving)

- 引入 `i18next` + `react-i18next`，初始化 + `I18nextProvider` 包裹 App
- 抽取并维护 zh / en 资源文件，**按模块 namespace** 拆分：`common` / `topbar` / `sidebar` / `settings` / `vault` / `schedule` / `study` / `ai` / `editor` / `rustErrors`（具体清单实施时按实际页面/组件收敛）
- locale 持久化（zustand store + localStorage），跟随系统 locale 首次启动
- 语言切换器 UI：**Topbar 下拉 + Settings 页偏好行双入口**，指向同一 store
- **MVP 全覆盖**：骨架 + 所有主页面（editor / schedule / study / settings / vault）的 UI 文案全部抽取到 i18n key
- **Rust 错误 i18n**：Rust 侧引入错误类别枚举（`Io` / `NotFound` / `Permission` / `Internal` 等），仅对用户可见错误返回 `{category, detail?}`；前端 `invoke` 包装层按 category 查 `rustErrors` namespace 翻译，未分类错误保留原文作 fallback。日志/toast 文本不动。

## Acceptance Criteria (evolving)

- [ ] 启动时按 `navigator.language` 或已持久化的 locale 加载对应语言包
- [ ] 切换语言后 UI 文案立即变化，无需刷新
- [ ] MVP 覆盖范围内所有可见中文字符串均来自 i18next key
- [ ] 切换 locale 后持久化，重启仍生效
- [ ] 缺失 key 时有 fallback（不抛错）

## Definition of Done

- 测试：至少给 locale 切换 / 资源加载写一个 vitest
- lint / typecheck / CI green
- 已有 UI 测试（如 ActivityBar.test.tsx 用 `getByTitle('设置')`）相应更新为基于 i18n key 或测试 wrapper
- 文档：在 README 补一句"i18n 已支持 zh/en，切换入口在 X"

## Out of Scope (explicit)

- Rust 侧**内部日志**与 OS-level 字符串本地化（保留原文）
- 插件 manifest 内的 title/description 本地化（plugin-host 层）
- 中文以外的第三语言（日/韩等）
- 用户自定义文案覆盖
- SSR / 多用户 locale 隔离
- i18n 资源懒加载（MVP 静态 import 即可）

## Implementation Plan (small PRs)

- **PR1（骨架）**：装 `i18next` + `react-i18next`；`apps/desktop/src/i18n/` 初始化；`localeStore` + persist；`I18nextProvider` 包 App；`LanguageSwitcher` 组件 + Topbar 挂载点；`common` namespace 起步（含通用按钮文案）。加一个 vitest 验证 locale 切换。
- **PR2（Settings + Vault）**：抽 `settings` / `vault` namespace，覆盖 SettingsPage + VaultPage 全部可见文案；更新对应测试。
- **PR3（editor + sidebar + topbar + commandPalette + search）**：抽 `editor` / `topbar` / `sidebar` namespace，覆盖编辑器壳层与搜索/命令面板。
- **PR4（schedule + study）**：抽 `schedule` / `study` namespace，覆盖两个工作台页面。
- **PR5（AI 面板 + 其余杂项）**：抽 `ai` namespace，覆盖 AiPanel、StatusBar、EmptyState 等。
- **PR6（Rust 错误 i18n）**：新增 `AppError` enum + serde；改造用户可见 invoke 命令的返回类型；前端 `tauriInvoke` 包装层 + `rustErrors` namespace；toast/dialog 接入。

## Research References

（无外部调研 —— 方案基于现有 stack 与代码量直接选定）

## Technical Notes

- 复用 `appearanceStore` 的持久化范式（zustand + persist）
- 资源 JSON 按 namespace 切分（如 `common.json`、`settings.json`、`vault.json`、`schedule.json`、`study.json`、`ai.json`、`editor.json`、`topbar.json` 等），按需懒加载
- i18next 浏览器语言检测 + localStorage cache
- locale 检测顺序：`localStorage > navigator.language > default zh`
- fallback：`fallbackLng='zh'`，`returnNull=false`，缺失 key 输出 key 本身 + `console.warn`
- 现有 UI 测试（如 `ActivityBar.test.tsx` 用 `getByTitle('设置')`）需在测试 wrapper 初始化 i18next（zh），或改为按 testid 查询
- Rust 错误类别方案：新建 `AppError` enum，invoke 命令返回 `Result<T, AppError>`，`AppError` serde 序列化为 `{category, detail?}`；前端 `invoke` 包装层捕获后查 `rustErrors:category` 翻译，`detail` 作为插值参数

## Technical Approach

**Approach: i18next + react-i18next + 模块 namespace + Rust 错误类别枚举**（已选）

- 初始化：`apps/desktop/src/i18n/index.ts` 创建 i18next 实例，注册 zh/en namespace bundles（静态 import，不走懒加载 —— bundle 体积可控，简化优先）
- React 集成：`main.tsx` 包 `I18nextProvider`，或直接用 `initReactI18next`
- locale store：`apps/desktop/src/store/localeStore.ts`，zustand + persist，`setLocale(lg)` 同步 `i18next.changeLanguage`
- 切换器：`Topbar` 右侧 `LanguageSwitcher` 下拉；`SettingsPage` 新增偏好行
- Rust：`src-tauri/src/errors.rs` 定义 `AppError` enum + serde；commands 用 `Result<T, AppError>`；前端 `services/tauriInvoke.ts` 包装层翻译

## Decision (ADR-lite)

**Context**: 全仓库 i18n，要求 zh/en，包括 Rust 错误。399 前端文件 + 12 Rust 错误点。

**Decision**:
- 前端：i18next + react-i18next，按模块 namespace 拆分资源文件
- locale：localStorage 持久化 + 跟随系统 locale 首启
- 切换器：Topbar 下拉 + Settings 行双入口
- Rust：错误类别枚举 + 前端 invoke 包装层翻译，仅覆盖用户可见错误，不对 OS 字符串逐条翻译

**Consequences**:
- 优点：架构清晰、扩展第三语言只加 JSON、Rust 侧改动有边界
- 缺点：MVP 工作量较大（前端 ~9 namespace + Rust enum refactor + 测试改造），需要分多个 PR
- 风险：现有 UI 测试断言中文文案需批量更新；Rust `AppError` 序列化变更可能影响已有调用点

## Research References

（无外部调研 —— 方案基于现有 stack 与代码量直接选定）
