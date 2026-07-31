# CLI 设置页：配置文件路径改为链接样式点击打开

## Goal

上一版加的"打开设置文件"按钮在用户机器上点击没反应（疑似按钮事件被吞或样式问题）。去掉按钮，改为把每张 CLI 卡片底部显示的 `settingsFilePath` 字符串渲染成可点击链接，点击即触发"打开或创建"流程（沿用上一版的 exists 判定 + missing 时 inline 提示 + 创建按钮逻辑，但触发器从独立的"打开设置文件"按钮改成路径链接本身）。

## Root Cause Hypothesis (按钮没反应)

- 上一版按钮 `disabled={sf.kind === 'creating'}` 不会卡住，但按钮放在 Test 按钮右侧；可能是用户视觉上没注意到，或事件冒泡被父容器某个 hover/focus 处理吞掉。
- 也可能 `externalFileProvider.exists` 抛错（Tauri scope 问题）但走 try/catch 后没显示——但 catch 里设置了 `kind: 'error'` 应该会显示。
- 不深挖按钮失效根因，直接按用户要求换形态。

## Requirements

- 移除 `CliSettings.tsx` 里"打开设置文件"按钮（cliPath 行尾的那个）。
- 卡片底部原本 `font-mono` 的 `a.settingsFilePath` 文字改为链接样式（蓝色/acc 色 + 下划线 + cursor-pointer + hover 加重），点击触发 `openAdapterSettings(a.id, a.settingsFilePath)`。
- 链接放在卡片底部的 hint 行旁边（保留现有 `cliPath.hint` 文字），单独一行更清晰：
  - 行 1: `t('settings:cli.cliPath.hint')`
  - 行 2: 链接式的 `a.settingsFilePath`
- missing 状态的 inline 提示 + 创建按钮保留不动（仍是按钮，因为提示行里需要一个明确的二级动作）。
- 移除 cliPath 行尾的"打开设置文件"按钮后，i18n 的 `cli.settingsFile.label` 和 `cli.settingsFile.title` 仍可保留（"创建"按钮、tooltip 等仍会用到）；若完全没用了就删掉。`title` 用于链接 hover 提示。

## Acceptance Criteria

- [ ] 卡片底部 `settingsFilePath` 以链接样式呈现（颜色 `--acc`，下划线，cursor pointer）。
- [ ] 点击链接 → 文件存在则在编辑器打开 ext tab；不存在则 inline 提示 + "创建"按钮显示。
- [ ] 不再有独立的"打开设置文件"按钮。
- [ ] hover 链接显示 `cli.settingsFile.title` 提示。
- [ ] typecheck + cli-adapter 单测全绿（无逻辑变更，只是 UI 重排）。

## Out of Scope

- 不深挖上一版按钮为何没反应。
- 不改 `externalFileProvider` / `editorIoService.openFile`。
- 不动 registry.ts / settings i18n 主结构（仅可能删一个未用 key 或保留）。

## Technical Notes

- 文件：`apps/desktop/src/components/settings/CliSettings.tsx`。
- 链接样式参考仓库里其它外部链接/可点击文本的写法（如 `text-acc hover:underline cursor-pointer`）。
- 链接是 `<a>` 还是 `<button>` 文本化：用 `<button>` + `appearance-none` 风格更安全（避免 `<a href>` 触发浏览器导航；保留键盘可达性）。
