# CLI 设置页：每个 Adapter 加"打开设置文件"按钮

## Goal

CLI 工具设置页（`SettingsPage → CliSettings`）每张 CLI 卡片增加一个"打开设置文件"按钮，点击后用 Quill 的 `editorIoService.openFile` 能力在编辑器里打开该 Adapter 对应的配置文件，让用户直接在 Quill 内查看 / 编辑。

例：
- claude → `~/.claude/settings.json`
- pi → `~/.pi/agent/models.json`

## What I already know

- `CliSettings.tsx:33` 已经在 `listAdapters().map(...)` 里渲染每张 adapter 卡片，路径配置 / Detect / Test 按钮都在 `apps/desktop/src/components/settings/CliSettings.tsx`。
- Adapter 元数据在 `packages/cli-adapter/src/registry.ts:11` 的 `ADAPTERS` 表里，目前只有 `displayName` / `description` / `factory`。
- Quill 已有打开外部文件的能力：
  - `apps/desktop/src/services/editorIoService.ts:81` `openFile(filePath, name)` —— 直接按路径打开，外部路径走 `externalFileProvider`。
  - `apps/desktop/src/utils/isExternalPath.ts:25` 把 `~/...` 判定为 external。
  - `apps/desktop/src/services/externalFileProvider.ts:23` `resolveHome()` 自己处理 `~` / `$HOME` 展开，调用 Tauri fs scope `$HOME/**` 已授权。
- 实测本机：
  - `~/.claude/settings.json` 存在（4KB）。
  - `~/.pi/agent/` 下并存 `models.json`（398B，provider/apiKey/model 列表）、`settings.json`（108B，UI 偏好如 theme）、`auth.json`、`models-store.json`（缓存）。用户明确指定 pi 用 `models.json`（ substantive config，非 UI prefs）。

## Assumptions (temporary)

- 配置文件路径属于 adapter 元数据，应放进 `registry.ts` 的 `AdapterDescriptor`，而不是在 `CliSettings.tsx` 里 hardcode。
- 路径用 `~` 前缀（home-relative），让 `externalFileProvider.resolveHome` 展开，避免 main process 提前 eval home。
- 文件不存在时 `openFile` 会抛错；MVP 先捕获并在卡片里显示 inline 提示 + 一个"创建"二级按钮（写空 JSON 模板）—— 待与用户确认。

## Open Questions

- （已解决）文件不存在时的行为 → 见 Decision。

## Requirements

- 在 `AdapterDescriptor` 上新增：
  - `settingsFilePath: string` —— home-relative，带 `~`。
  - `settingsFileTemplate?: string` —— 创建文件时写入的初始内容。
- `listAdapters()` 返回值带上 `settingsFilePath` 与 `settingsFileTemplate`。
  - claude → `'~/.claude/settings.json'`，template `'{}\n'`。
  - pi → `'~/.pi/agent/models.json'`，template `'{\n  "providers": {}\n}\n'`。
- `CliSettings.tsx` 每张卡片在 Test 按钮旁新增"打开设置文件"按钮，点击：
  1. 先用 `externalFileProvider.exists(settingsFilePath)` 判断文件是否存在。
  2. 存在 → 调 `editorIoService.openFile(settingsFilePath, basename)`。
  3. 不存在 → 卡片 inline 显示"文件不存在"提示 + 一个"创建"按钮。点"创建" → 用 `externalFileProvider.writeFile(path, template)` 写盘（自动 mkdir -p），成功后立即 `openFile`。

## Acceptance Criteria

- [ ] claude 卡片点"打开设置文件"且文件存在 → 编辑器新开 `ext:~/.claude/settings.json` tab，内容是磁盘上 settings.json 的 JSON。
- [ ] pi 卡片点"打开设置文件"且文件存在 → 编辑器新开 `ext:~/.pi/agent/models.json` tab。
- [ ] 重复点击同一 adapter 的按钮 → 复用已存在的 ext tab（不重复开）。
- [ ] 编辑后保存（既有 `saveFile` 流程）写回原路径。
- [ ] 文件不存在时 → 卡片 inline 提示"文件不存在"+ 显示"创建"按钮；点"创建" → 写入 `settingsFileTemplate` 并立即在编辑器打开。
- [ ] `registry.test.ts` 加一条断言：`listAdapters()` 返回包含 `settingsFilePath` / `settingsFileTemplate`，claude 和 pi 的值符合 PRD。

## Definition of Done

- `pnpm typecheck` 通过。
- `packages/cli-adapter` 的单测 `registry.test.ts` 加一条断言：`listAdapters()` 返回包含正确的 `settingsFilePath`。
- 手测 claude / pi 两个卡片按钮的 happy path + 文件不存在的失败路径。

## Out of Scope (explicit)

- 不在本任务里新增 Adapter（如新增 Gemini CLI）。
- 不改 pi 的 `models.json` schema 或 claude 的 settings schema。
- 不在 Quill 里做 JSON schema 校验 / 字段补全；用户编辑后照原样写回。
- 不改 `externalFileProvider` / `editorIoService.openFile` 的现有契约。
- 不做创建文件前的"是否覆盖"二次确认 —— MVP 直接写模板，覆盖路径上已有文件的风险由 `exists()` 判定规避（存在就不会进创建流程）。

## Decision (ADR-lite)

**Context**: 配置文件可能在用户首次安装 Quill 时还不存在（pi 尤其如此）。
**Decision**: 点"打开设置文件"先 `exists` 判定；不存在时 inline 提示 + "创建"按钮，创建即写入 adapter 模板并立即打开。
**Consequences**:
- 创建按钮把"先跑一次 CLI 让其生成配置"这一步省掉，新机用户上手顺。
- 模板写在 `AdapterDescriptor.settingsFileTemplate`，每个 adapter 自己声明最小合法 shape（claude `{}`, pi `{"providers": {}}`）。后续新增 adapter 时各自维护。
- 不做"覆盖确认"——只在 `exists=false` 时才进创建路径，不会误删已有文件。

## Technical Notes

- `CliSettings.tsx:62` 已经在用动态 `import('@tauri-apps/plugin-shell')` 跑 detect / test 命令；新按钮不需要 shell，只需要 `editorIoService.openFile`。
- `externalFileProvider.resolveHome` 已处理 `~`，所以 `openFile('~/...')` 透明可用。
- `openFile` 内部用 `ext:${filePath}` 作 tab id，重复打开会复用 tab（见 `editorIoService.ts:89`）。
