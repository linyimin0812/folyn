# markdown codeblock script runner

## Goal

让 Markdown 预览页的代码块可直接运行 shell / node / python 脚本，将运行结果以 `> Result:` 引用块写回编辑器源文件；编辑器设置页提供运行时可执行路径配置 + 检测；运行中支持手动停止。运行时配置抽象成 `RuntimeConfig`，未来可加新运行时无需求改运行逻辑。

## Requirements

### 运行时抽象
- `RuntimeConfig` 接口：`{ id, label, binaryPath, languageAliases: string[], fileExt, detectCommand, versionArgs }`
- 默认三条配置（shell / node / python），种子写入 store 初始 state
- 运行逻辑通用：给定 `RuntimeConfig` + 代码文本 → 写临时文件 → `Command.create('claude-cli', ['-l', '-c', `${binaryPath} ${tmpFile}`]).spawn()` → 订阅 `stdout`/`stderr`/`close` → `child.kill()` 停止

### 预览页（`MarkdownPreview.tsx`）
- `CodeBlockWrapper` 解析子 `<code>` 的 `language-<lang>` className，匹配任一 `RuntimeConfig.languageAliases` 命中即显示 Run 按钮
- Run 按钮：play 图标，颜色 `#59A869`；运行中切换为 Stop 按钮：pause 图标，颜色 `#C7222D`
- 运行中：代码块下方实时流式展示 stdout/stderr（一个 `<div className="code-run-output">` 容器）
- Stop 按钮：调用 `child.kill()`，输出区追加 `[stopped]` 标记
- 进程结束：展示 `[exit N]`；exitCode = 0 时只展示输出
- 结束后：把输出 + exit 标记格式化为 `> Result:` 引用块，写回编辑器源文件

### 写回编辑器
- 写回格式：
  ```
  ```bash
  echo hello
  ```

  > Result:
  > hello
  > [exit 0]
  ```
- 重复运行：替换紧邻代码块下方的既有 `> Result:` 块内容；不存在则在代码块后追加
- 写回链路：`MarkdownPreview` 接收并消费 `onChange(newContent)` prop → `PreviewPane.onChange` → `WorkArea` → `editorStore`

### 设置页（`SettingsPage.tsx` editor tab 末尾新增 section）
- 三行：shell / node / python
- 每行：路径输入框 + Detect 按钮 + Test 按钮
- Detect：`/bin/sh -lc 'which <binary>'` 找路径，自动填入
- Test：`<binary> --version` 验证，结果（成功/失败 + 文案）展示 6s 后清除
- 复用 `CliSettings.tsx` 的 detect/test 模式 + 状态管理

### Store
- 在 `aiConfigStore` 新增 `scriptRuntimes: RuntimeConfig[]` 字段 + `setRuntimePath(id, path)` setter
- 持久化走现有 `settingsPersistence.ts`（与 `cliPaths` 同路径）

### i18n
- `settings.json`（en + zh）补齐 `settings.editor.scriptRuntime.*` key：title / description / detect / test / testSuccess / testFailed / pathHint

## Acceptance Criteria

- [ ] ` ```bash ` / ` ```js ` / ` ```python ` 代码块预览页右上角显示 Run 按钮（颜色 `#59A869`）
- [ ] Run 按钮点击后切换为 Stop 按钮（颜色 `#C7222D`）
- [ ] stdout/stderr 实时流式显示在代码块下方
- [ ] Stop 可中断运行中的进程，输出区追加 `[stopped]` 标记
- [ ] 进程结束展示 `[exit N]`（exit 0 也展示）
- [ ] 运行结束后写回 `> Result:` 引用块；重复运行替换既有块
- [ ] Editor settings tab 末尾有 "脚本运行时" section，三行（shell/node/python）
- [ ] Detect 按钮自动填入运行时路径
- [ ] Test 按钮验证路径可用并展示结果
- [ ] 配置持久化（重启后仍在）
- [ ] 不支持的语言（如 `mermaid`、`json`）不显示 Run 按钮
- [ ] 不引入新 Tauri shell scope 权限（复用 `claude-cli` sidecar）

## Definition of Done

- 类型检查 / lint / 现有测试通过
- 新增 services / store 有最小单测：
  - `scriptRunnerService`：语言→运行时映射、临时文件写/删、命令拼装
  - `aiConfigStore.scriptRuntimes`：setRuntimePath + 持久化 round-trip
- `MarkdownPreview` 渲染 Run/Stop 按钮 + 输出区最小渲染测试（mock Tauri Command）
- Tauri capabilities 无变更
- i18n 中英文补齐
- 不影响现有 `CodeBlockWrapper` 的 copy 按钮 / 行号逻辑

## Technical Approach

### 核心文件
- 新建 `apps/desktop/src/services/scriptRunner/scriptRunnerService.ts`：`RuntimeConfig` 类型、`runScript(config, code, handlers)` 返回 `{ child, done }`、`mapLanguageToRuntime(lang, configs)`、`formatResultBlock(output, exitCode)` / `replaceOrAppendResultBlock(content, codeBlockRange, resultBlock)`
- 新建 `apps/desktop/src/services/scriptRunner/scriptRunnerService.test.ts`
- 改 `apps/desktop/src/components/file-types/markdown/MarkdownPreview.tsx`：`CodeBlockWrapper` 注入 Run/Stop 按钮 + 输出区；调用 `onChange` 写回
- 改 `apps/desktop/src/store/aiConfigStore.ts`：新增 `scriptRuntimes` 字段 + 默认三条 + `setRuntimePath`
- 改 `apps/desktop/src/store/settingsPersistence.ts`：持久化 `scriptRuntimes`
- 改 `apps/desktop/src/components/pages/SettingsPage.tsx`：editor tab 末尾新增 section（抽成 `<ScriptRuntimesSettings />` 子组件更清爽）
- 新建 `apps/desktop/src/components/settings/ScriptRuntimesSettings.tsx`
- 改 `apps/desktop/src/i18n/locales/{en,zh}/settings.json`：补 scriptRuntime key

### 执行流程
1. 用户点 Run → `CodeBlockWrapper` 调 `scriptRunnerService.runScript(config, code, { onStdout, onStderr, onClose })`
2. service：写 `await tempDir() + '/folyn-run-<rand>.<ext>'` → `Command.create('claude-cli', ['-l', '-c', `${binaryPath} ${tmpFile}`]).spawn()` → 订阅事件
3. UI：流式 append 到输出区；Stop 按钮调 `child.kill()`
4. close 事件到达：删除临时文件；调 `onChange(formatResultBlock(output, exitCode))` 写回
5. 写回函数：在代码块 fence 结束位置之后，找紧邻的 `> Result:` 块（到下一个非 `>` 行或文件尾）；存在则替换，不存在则追加（保留一个空行分隔）

### 颜色 / 图标
- Run SVG 内联，`style={{ color: '#59A869' }}`，13×13
- Stop SVG 内联，`style={{ color: '#C7222D' }}`，13×13

## Decision (ADR-lite)

- **Context**：Tauri 已有 `claude-cli` sidecar（`/bin/sh -lc`），无需新增 shell scope；编辑器 settings tab 已有，UI 模式可复用 CliSettings 的 detect/test；MarkdownPreview 的 `CodeBlockWrapper` 已是 React 组件、注入按钮成本低。
- **Decision**：复用 `claude-cli` sidecar 跑所有运行时；新增 `RuntimeConfig` 抽象层，运行逻辑通用、运行时配置化（默认 shell/node/python，未来加运行时只加配置项）；写回格式 `> Result:` 引用块；临时文件方式跑多行脚本；不超时，仅手动 Stop；settings 挂在 editor tab 末尾。
- **Consequences**：① 临时文件有写盘开销，但换得引号/转义零踩坑；② 不超时意味着长任务（如 server）会一直跑，依赖用户主动 Stop；③ 复用 `claude-cli` sidecar 意味着所有运行时都过 `/bin/sh -lc`，运行时路径必须能被 `/bin/sh -lc` 找到（即用户 login shell 的 PATH 中）—— 若 node 装在 nvm 下，`-l` 会加载 `.zshrc`/`.bashrc`，应能找到。

## Out of Scope

- 不支持运行时容器化 / 沙箱
- 不做网络隔离
- 不支持多脚本并发队列（同一代码块同时只跑一个）
- 不支持 stdin 交互输入
- 不支持自定义运行参数 / 环境变量配置（MVP 用默认）
- 不支持运行时新增/删除（MVP 固定三条，未来扩展靠改 store 默认值或后续 PR 加 UI）
- 不做超时
- 不支持非 shell/node/python 语言（其他语言不显示 Run 按钮）

## Technical Notes

- Tauri shell sidecar 配置：`apps/desktop/src-tauri/capabilities/default.json:18-46`（`claude-cli` / `pi-cli`，`/bin/sh`，`args: true`，含 `allow-spawn` / `allow-execute` / `allow-stdin-write` / `allow-kill`）
- `Command.create('claude-cli', ['-l', '-c', cmd]).spawn()` 返回 `Child`，有 `.write(stdin)` / `.kill()`，事件 `stdout`/`stderr`/`close`
- `CliSettings.tsx:60-93` 是 detect/test 模式模板
- `MarkdownPreview.tsx:155-203` 是 `CodeBlockWrapper` 现状（含 copy 按钮逻辑）
- `PreviewPane.tsx:17` 已有 `onChange?: (content: string) => void` prop 透传机制
- 临时文件路径：`@tauri-apps/api/path` 的 `tempDir()`，写文件用 `@tauri-apps/plugin-fs` 的 `writeTextFile`
- 持久化：`settingsPersistence.ts` 已有 `cliPaths` 持久化模式，复制一份即可
- i18n：`apps/desktop/src/i18n/locales/{en,zh}/settings.json`

## Research References

（无外部研究；本任务凭现有代码模式 + Tauri 标准库即可完成）
