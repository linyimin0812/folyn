# window-activity-collector Windows front-window fix

## Goal

窗口活动采集器在 Windows 下采不到任何事件：github 采集器在同一台机器上正常运行（证明 runtime/invoke/SQLite 链路在 Windows 全通），唯一失效点是 `activity_front_window` 的 Windows 实现（`activity/mod.rs` `front_window()`，powershell + Add-Type P/Invoke 脚本）静默返回 `None`，导致 `collectWindowActivity` 永远返回 0 事件。macOS 分支（osascript）无此问题。

## What I already know

- Windows `front_window()`（apps/desktop/src-tauri/src/activity/mod.rs:125-146）：`Command::new("powershell")` + `-Command` 单参数脚本（内嵌大量 `"`），Add-Type 编译 P/Invoke 类，`Get-Process | Where MainWindowHandle -eq $h` 匹配进程名，输出 `app|title`。任一步失败 → `None` → 无事件、无报错（采集记录 outcome=ok accepted=0）。
- 潜在失败面（按可疑度）：
  1. 脚本经 Rust `Command` 传参时的引号转义（Rust 转义为 `\"`，powershell.exe 自有命令行解析规则）
  2. Add-Type 每次轮询重新编译（受 CLM/AppLocker/环境限制）
  3. `MainWindowHandle -eq 前台HWND` 匹配不到（UWP 前台窗口属 ApplicationFrameHost、提权窗口等）→ 输出 `|title` → app 为空 → `None`
  4. GUI 子系统进程 spawn console 程序的窗口闪烁（非失败，但体验差）
- `windows-sys` 0.59 已是 `cfg(target_os="windows")` 直接依赖，features 含 `Win32_UI_WindowsAndMessaging` / `Win32_Foundation`（GetForegroundWindow/GetWindowTextW/GetWindowThreadProcessId 可用）；`Win32_System_Threading`（OpenProcess/QueryFullProcessImageNameW）需加一行 feature。
- 采集器 JS 侧（extensions/window-activity-collector/src/windowActivity.ts）无需改动：只消费 `ctx.frontWindow()` 的 `{app,title}|null`。
- macOS 用户已确认正常；github「无法采集」是用户没点保存，已排除。

## Assumptions (temporary)

- Windows 机器为普通 Win10/11（非 CLM 企业锁死环境）
- 用户未跑 PowerShell 手动测试，具体失败步骤未知 → 选「整体替换」而非「修补脚本」的方案可不依赖该信息

## Requirements

- Windows 下 `activity_front_window` 用 Rust FFI（windows-sys）直调 user32/kernel32 取前台窗口，稳定返回 `{app, title}`
- app 名 = 前台窗口真实属主进程的可执行文件名去扩展名（QueryFullProcessImageNameW）
- 失败路径 `log::warn!` 留诊断痕迹（不再完全静默）
- macOS 行为零改动（`cfg` 分支隔离）

## Decision (ADR-lite)

**Context**: PowerShell 脚本失败步骤未知（引号转义 / Add-Type / MainWindowHandle 匹配三处都可疑），用户无法即时跑手动诊断。
**Decision**: 方案 A —— Rust FFI 直调替换整个 PowerShell 分支（用户 2026-09-27 确认）。
**Consequences**: ~50 行 unsafe FFI + Cargo.toml 加 `Win32_System_Threading` feature；整类环境性故障（PS 转义/Add-Type/CLM/进程匹配启发式）一次清除；轮询开销秒级→微秒级；Windows 分支无法在 macOS 开发机上测试，验收依赖用户 Windows 机器。

- [ ] Windows 机器上开启窗口活动采集后，时间线出现 `window_activity` 事件（app/title 正确）
- [ ] 前台切换应用后 60s 轮询周期内出现新事件（cursor 变化语义不变）
- [ ] macOS 采集行为不回归（编译期隔离，`cfg` 双分支）
- [ ] `cargo check`（Windows target 交叉检查）/ 本机测试通过

## Definition of Done (team quality bar)

- Rust 侧改动有最小自检（可用 `#[cfg(test)]` 覆盖纯逻辑部分，如字符串截断/文件名解析）
- lint / typecheck / 现有测试不回归
- PRD 记录 ADR 决策

## Out of Scope (explicit)

- macOS osascript 分支重写
- 采集频率/采样粒度调整（60s floor 不动）
- UWP 应用名的友好显示（ApplicationFrameHost → 真实应用名需 IApplicationActivationManager，标记为已知上限）
- github-collector（用户配置问题，非代码缺陷）

## Technical Notes

- 关键文件：apps/desktop/src-tauri/src/activity/mod.rs:125-146（Windows 分支）、apps/desktop/src-tauri/Cargo.toml（windows-sys features）
- FFI 序列：GetForegroundWindow → GetWindowTextW → GetWindowThreadProcessId → OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION) → QueryFullProcessImageNameW → 路径文件名去扩展名作 app 名
- 失败诊断信息可用 log crate（已是全平台依赖）
