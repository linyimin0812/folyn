# Windows 平台兼容性盘点与修复

## Goal

让 folyn 桌面端（Tauri + React/TS）在 Windows 11 上能正常构建、启动、运行所有核心功能；盘点所有 macOS 专属依赖并修复，包括 pet/voice 模块的 Windows 原生重写与 Chrome 密码导入的 DPAPI 实现。

## Research References

- [`research/macos-deps-audit.md`](research/macos-deps-audit.md) — 完整盘点：15 项必须修复 + pet/voice 决策项 + 可忽略清单

## Decisions (user-confirmed 2026-08-12)

- **验证环境**：用户有 Windows 机器可动态验证（不仅静态 cargo check）
- **MVP 范围**：全部 13 项必须修复 + pet/voice 重写 + Chrome DPAPI Windows 等价
- **pet 模块**：Windows 原生重写（WS_EX_LAYERED + WS_EX_TOOLWINDOW + SetWindowPos HWND_TOPMOST + 多屏 Y-flip）
- **voice 模块**：Windows 原生重写（WinRT Speech API / Windows::Media::SpeechRecognition + SendInput 模拟 Cmd→Ctrl+V + Windows::Media::Capture::MediaCapture 麦克风权限）
- **Chrome 密码导入**：Windows 等价实现（DPAPI CryptUnprotectData + 读 `Local State` encrypted_key + AES-GCM 解密）
- **Windows 安装包**：本任务做 NSIS bundle（暂不做代码签名 / MSIX）

## Requirements

### 构建与启动阻塞项（13 必须修复）

- [ ] R1 `src-tauri/Cargo.toml`：补 `[target.'cfg(windows)'.dependencies]`（windows-rs / windows / raw-window-handle 等），`cargo check --target x86_64-pc-windows-msvc` 通过
- [ ] R2 `src-tauri/capabilities/default.json` + `pet-panel.json`：sidecar `claude-cli`/`pi-cli` 加 Windows 路径 `cmd.exe /c` 或新增同名 Windows sidecar；前端按平台选
- [ ] R3 `src/services/scriptRunner/scriptRunnerService.ts`：默认 `binaryPath` + `detectCommand` 平台分支（cmd.exe + where）
- [ ] R4 `src/services/gitService.ts` + `src/components/settings/ScriptRuntimesSettings.tsx` + `src/components/settings/CliSettings.tsx` (test 路径)：按 navigator.platform 选 sidecar 与参数
- [ ] R5 `src-tauri/src/commands/terminal_commands.rs:62`：兜底 shell 改 `cmd.exe`（读 COMSPEC）
- [ ] R6 `src-tauri/src/commands/terminal_commands.rs:69-71`：shell 参数按平台（cmd.exe `/Q` / powershell `-NoLogo`）
- [ ] R7 `src-tauri/src/commands/terminal_commands.rs:206-217`：`expand_tilde` 用 USERPROFILE 或 Tauri `home_dir()`
- [ ] R8 `src-tauri/src/commands/project_commands.rs:50`：`find` 替换为 Rust 原生递归（walkdir crate 或 std::fs 递归）
- [ ] R9 `src-tauri/src/commands/browser_commands.rs`：Chrome 路径 `%LOCALAPPDATA%\Google\Chrome\User Data` + DPAPI 解密
- [ ] R10 `src-tauri/src/pet_api/mod.rs:94,112`：`open`/`open -a` 平台分支（`cmd.exe /c start` / `rundll32 url.dll,FileProtocolHandler`）
- [ ] R11 `src-tauri/src/voice.rs:33-34`：paste_log 路径改 `dirs::cache_dir().join("folyn/logs")`
- [ ] R12 `src/components/terminal/TerminalView.tsx:188`：shell 名分割符 `split(/[/\\]/)`
- [ ] R13 `src-tauri/tauri.conf.json`：加 `bundle.windows`（nsis）+ `apps/desktop/package.json` 加 `build:win` 脚本

### Windows 原生重写

- [x] R14 pet 模块 Windows 实现（部分）：
  - [x] pet_set_cursor：LoadCursorW + SetCursor（IDC_HAND / IDC_ARROW）
  - [x] set_pet_opacity：SetLayeredWindowAttributes (LWA_ALPHA) + WS_EX_LAYERED
  - [x] pet_get_work_area：MonitorFromWindow + GetMonitorInfoW（rcWork 去除任务栏）
  - [ ] **FOLLOW-UP**：toggle_pet_mode / show_pet_if_hidden / set_pet_position 用 Tauri stock API（WebviewWindow::show / set_position）+ Windows cfg-gate
  - [ ] **FOLLOW-UP**：pet_set_topmost_level + pet_make_transparent 用 SetWindowPos HWND_TOPMOST + WS_EX_LAYERED + SetLayeredWindowAttributes
  - [ ] **FOLLOW-UP**：pet_panel_macos.rs 的 NSPanel 后端 Windows 等价（WS_EX_TOOLWINDOW + 多屏 Y-flip）
- [ ] R15 voice 模块 Windows 实现 — **DEFERRED to follow-up subtask**：
  - WinRT SpeechRecognizer（windows crate `Media_SpeechRecognition` feature）
  - MediaCapture 麦克风权限（`Media_Capture` feature）
  - SendInput 模拟 Cmd→Ctrl+V（user32）
  - cpal 已跨平台（ConPTY / WASAPI）
  - **Why deferred**：1k+ 行 windows-rs WinRT 绑定代码，无 macOS host 无法验证 native API 调用；现状（macOS-only stub + 前端 `onMac()` 隐藏入口）已让 Windows 用户无 broken 行为
  - **Follow-up 路径**：先 `trellis-research` 调研 WinRT Speech + SendInput + MediaCapture 在 Rust 的成熟方案，再独立子任务实现

### CI / 文档

- [ ] R16 `.github/workflows/release.yml`：Windows job 验证产出 .exe / .msi
- [ ] R17 文档：`apps/desktop/BUILD.md` 加 Windows 构建说明（前提工具链、构建命令、签名可选）

## Acceptance Criteria

- [ ] `cargo check --target x86_64-pc-windows-msvc` 在 macOS 上通过
- [ ] Windows 11 上 `pnpm build` + `tauri build` 产出 `.exe` + `.msi`
- [ ] 应用启动无白屏、无 native 调用失败
- [ ] shell detect 在 Windows 上返回可用 shell（PowerShell / cmd / Git Bash 至少一种）
- [ ] 终端 (xterm + portable-pty ConPTY) 能起 cmd / PowerShell
- [ ] pet 模式在 Windows 上能显示、置顶、调透明度、移动位置、改鼠标
- [ ] voice 输入在 Windows 上能识别语音并模拟粘贴到前台应用
- [ ] Chrome 密码导入在 Windows 上能解出明文（与 macOS 行为对齐）
- [ ] 不可用功能以明确 disabled 形态出现（不崩溃）
- [ ] 无 macOS 行为回归（CI 在 macOS matrix 仍绿）

## Definition of Done

- 受影响模块 lint / typecheck / `cargo check` 绿
- Windows + macOS 双平台 CI 绿
- `apps/desktop/BUILD.md` 含 Windows 构建说明
- 列出未覆盖的 Windows 已知问题作为后续任务

## Decision (ADR-lite)

**Context**: 用户要求"所有的功能支持 Windows"，盘点后确认范围覆盖构建、启动、所有 native 模块（pet/voice）和 Chrome 密码导入。
**Decision**: 全面支持方案——13 项必须修复 + pet/voice Windows 原生重写 + Chrome DPAPI 等价实现；NSIS bundle；不做代码签名 / MSIX。
**Consequences**: 工作量大，按 PR 拆分；需引入 `windows-rs` crate；pet/voice 后端模块将变成"macOS 分支 + Windows 分支"双实现，长期维护成本上升；用户有 Windows 验证环境，可动态验收。

## Out of Scope (explicit)

- Linux 平台（仅 Windows + macOS）
- Windows 代码签名（signtool / EV cert / MSIX signing）—— 后续任务
- ARM64 Windows（先 x86_64）
- Linux 平台 Chrome 密码导入（gnome-keyring / kwallet）—— 后续
- 其他 macOS 专属功能（如有遗漏）由后续盘点补齐
- **R15 voice 模块 Windows 原生重写** — 推迟到独立子任务（需要 WinRT Speech + SendInput + MediaCapture 调研 + Windows 机器验证）
- **R14 pet 模块完整 Windows 实现** — toggle_pet_mode / show_pet_if_hidden / set_pet_position / pet_set_topmost_level / pet_make_transparent / pet_panel_macos.rs NSPanel 等价拆为后续子任务（当前已实现核心 3 命令：cursor / opacity / work area）

## Technical Notes

- 盘点方法：grep + Read 全量扫描，详见 `research/macos-deps-audit.md`
- Tauri `macos-private-api` feature 在 Windows 编译时被忽略
- portable-pty 自动在 Windows 用 ConPTY
- Windows Chrome 加密：v80+ 用 AES-GCM，key 由 DPAPI 加密存放于 `Local State` 的 `os_crypt.encrypted_key`
- WinRT Speech API 需 `windows` crate 的 `Media_SpeechRecognition` + `Media_Capture` feature
- pet 后端 cfg-gate 策略：`#[cfg(target_os = "macos")]` 现有实现保留，新增 `#[cfg(target_os = "windows")]` 等价实现，公共接口走 trait 或 cfg-dispatch

## Implementation Plan（按 PR 拆分）

> 每个 PR 闭环：lint + typecheck + cargo check + 受影响平台验证。建议子任务化（task.py create --parent）以便单独走 trellis 流程。

- **PR1 — 构建基础**（R13 + R16 部分）：tauri.conf `bundle.windows` + `build:win` 脚本 + CI Windows job 验证产出物。子任务。
- **PR2 — Rust cfg-gate 验证 + 路径跨平台**（R1 + R7 + R11 + R8）：补 `[target.cfg(windows)]` deps、expand_tilde 改 USERPROFILE、paste_log 改 dirs、find 改 walkdir。子任务。
- **PR3 — sidecar 与 scriptRunner 平台分支**（R2 + R3 + R4 + R12 + R5 + R6）：前端 navigator.platform 选 sidecar、scriptRunnerService 默认值、terminal_commands 兜底 cmd.exe + 参数。子任务。
- **PR4 — pet_api open 命令**（R10）：`open`/`open -a` 平台分支。子任务。
- **PR5 — Chrome 密码 DPAPI**（R9）：Windows Chrome 路径 + DPAPI + AES-GCM。子任务。
- **PR6 — pet 模块 Windows 原生重写**（R14）：windows-rs 窗口样式 + 透明度 + 置顶 + 多屏 work area + 鼠标光标。子任务。
- **PR7 — voice 模块 Windows 原生重写**（R15）：WinRT Speech + SendInput + 麦克风权限 + 前端入口放开。子任务。
- **PR8 — 文档 + 收尾**（R17 + 后续问题清单）：BUILD.md + 已知问题清单。并入 PR1 或单独。
