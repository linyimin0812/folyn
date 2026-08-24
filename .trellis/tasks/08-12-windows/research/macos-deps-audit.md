# macOS 专属依赖盘点（Windows 兼容性）

盘点范围：`apps/desktop/` + `src-tauri/` + `scripts/` + `.github/workflows/`。
方法：grep + Read 全量扫描。已跨平台条目不列入。

---

## 必须修复（不修复 Windows 无法构建/启动）

| # | 位置 | 问题 | 修复方向 |
|---|------|------|---------|
| 1 | `src-tauri/Cargo.toml:108-128` | macOS 专属 crate（cocoa/objc/objc2/tauri-nspanel）已 cfg-gate，但需 `cargo check` 确认 Windows 编译通过 | 验证 + 必要时补 `[target.'cfg(windows)'.dependencies]` |
| 2 | `src-tauri/capabilities/default.json:36,41,46,56,61,66` + `pet-panel.json` | `claude-cli`/`pi-cli` sidecar `cmd:"/bin/sh"` Windows 无法解析 | 为 Windows 定义同名 sidecar 走 `cmd.exe /c` 或前端按平台选 |
| 3 | `src/services/scriptRunner/scriptRunnerService.ts:37,40,49,58` | 默认 `binaryPath:'/bin/sh'`、`detectCommand:'which ...'` | 平台分支：cmd.exe + where |
| 4 | `src/services/gitService.ts:111` + `src/components/settings/ScriptRuntimesSettings.tsx:44,59` | 固定 `claude-cli ['-l','-c']` | 按 navigator.platform 选 sidecar 与参数，参考 `CliSettings.tsx:115-121` |
| 5 | `src/components/settings/CliSettings.tsx:138-140` | test 路径未分平台（detect 已分） | 复用 detect 的 isWin 分支 |
| 6 | `src-tauri/src/commands/terminal_commands.rs:62` | `"/bin/zsh"` 兜底 | 改 `cmd.exe`（读 COMSPEC） |
| 7 | `src-tauri/src/commands/terminal_commands.rs:69-71` | zsh/bash 加 `-i`，Windows shell 不认 | cmd.exe `/Q` 或 powershell `-NoLogo` |
| 8 | `src-tauri/src/commands/terminal_commands.rs:206-217` | `expand_tilde` 用 HOME env | USERPROFILE 或 Tauri `home_dir()` |
| 9 | `src-tauri/src/commands/project_commands.rs:50` | `find -maxdepth ...` | Rust 原生递归或 walkdir crate |
| 10 | `src-tauri/src/commands/browser_commands.rs:58,101` | Chrome Keychain 路径 + `/usr/bin/security` | Windows: `%LOCALAPPDATA%\Google\Chrome\User Data` + DPAPI |
| 11 | `src-tauri/src/pet_api/mod.rs:94,112` | `open`/`open -a` | `cmd.exe /c start` 或 `rundll32 url.dll,FileProtocolHandler` |
| 12 | `src-tauri/src/voice.rs:33-34` | `~/Library/Logs/...` paste_log | `dirs::cache_dir().join("folyn/logs")` |
| 13 | `src/components/terminal/TerminalView.tsx:188` | `shell.split('/')` 取名 | `split(/[/\\]/)` |
| 14 | `src-tauri/tauri.conf.json:38-42` | 仅 `bundle.macOS` | 加 `bundle.windows`（nsis 或 wix） |
| 15 | `apps/desktop/package.json:9` | 仅 `build:mac` | 加 `build:win` 脚本 |

## 应修复（影响功能但不阻塞启动）

- **pet 模式**（`src-tauri/src/commands/pet_commands.rs` + `pet_panel_macos.rs`）：Windows 完全不可用。决策：禁用（前端隐藏入口）vs 重写（WS_EX_LAYERED + SetWindowPos HWND_TOPMOST）。
- **voice 模式**（`src-tauri/src/voice.rs` + `voice/*`）：已 stub 返回 "voice input is macOS-only"。决策：禁用 vs WinRT Speech + SendInput。
- `src-tauri/src/commands/terminal_commands.rs:80-94`：`TERM`/`SOBOLE_THEME_MODE` 在 Windows cmd/PS 无意义，跳过。
- `.github/workflows/release.yml`：已含 Windows matrix，缺 signtool/MSIX 步骤（如需签名）。

## 可忽略（已跨平台或仅文档/测试 fixture）

- `utils/platform.ts`、`isExternalPath.ts`、`pathResolver.ts`、`plugin_commands.rs:79`、`chat.rs:284`、`browser_commands.rs:445,464,479` — 已用 `app.path().home_dir()` / `app_data_dir()`
- `portable-pty` — 自动 ConPTY
- `services/plugin-host/keybindingAdapter.ts:61-75` — isDarwin 已分平台
- `hooks/useVoiceInput.ts:60`、`VoiceInputButton.tsx:31`、`VoiceSettings.tsx:140` — onMac() 在 Windows 直接禁用 voice，符合预期
- `components/file-types/markdown/MarkdownPreview.tsx:520`、`web/WebViewer.tsx:506`、`study/StudyMaterialsSection.tsx:87` — plugin-shell.open 跨平台
- `apps/desktop/scripts/dev-voice.mjs`、`build-mac.sh` — 本身 macOS 专属，不删无害
- `Info.plist`、`Entitlements.plist` — macOS 配置，Windows 构建不读
- 测试 fixture 中 `/Users/...` 字面量 — 不影响运行时

## 副产物

- `.github/workflows/release.yml` 已有 Windows matrix（`windows-latest / x86_64-pc-windows-msvc`），CI 基础设施就绪
- Tauri `targets:"all"` + `plugins.shell.open:true` 已配置
