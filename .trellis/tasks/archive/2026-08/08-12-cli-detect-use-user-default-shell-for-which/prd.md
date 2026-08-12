# CLI detect should use user's default shell, not /bin/sh

## Goal

`CliSettings` 的 detect 按钮当前通过 `/bin/sh -lc "which claude"` 检测 CLI 路径。Tauri GUI 进程的 PATH 与用户终端不同（launchd 派生，不读 `~/.zshrc`），`/bin/sh -l` 又只读 `/etc/profile` + `~/.profile`，所以 `which` 命中 cmux 在 `/etc/paths.d/` 注入的 shim 路径（`/var/folders/.../cmux-cli-shims/<UUID>/claude`），而非用户终端里真实的 `~/.local/bin/claude`。shim 路径带 UUID，重启后失效，写入 `cliPaths` 是个定时炸弹。

要让 detect 返回用户在交互终端里实际会用到的那条 CLI 路径。

## What I already know

- detect 代码：`apps/desktop/src/components/settings/CliSettings.tsx:106-117`，`Command.create('claude-cli', ['-l', '-c', `which ${adapterCmd}`])`
- sidecar 定义：`apps/desktop/src-tauri/capabilities/default.json:31-44`，`{ name: "claude-cli", cmd: "/bin/sh", args: true }`，`pet-panel.json:17-30` 同样
- sidecar 复用范围广：`CliSettings.tsx`（detect + version test）、`ScriptRuntimesSettings.tsx:44,59`、`gitService.ts:111`、`scriptRunnerService.ts:94`、`claudeAdapter.ts:143`、`piAdapter.ts:348` —— 改 sidecar 的 cmd 会牵动所有这些地方，但 Tauri 的 `cmd` 是静态字符串，无法在运行时解析用户 shell
- `buildAdapterVersionCommand(adapterId, cliPath)`（`packages/cli-adapter/src/piAdapter.ts:117`）：pi 用 `buildPiShellCommand` 走 sibling-node；claude 用 `exec <cliPath> --version`
- 平台：当前主要面向 macOS（用户实例是 Darwin 25.5.0）；是否支持 Linux/Windows 未确认
- cmux shim 在 `/etc/paths.d/`（推断，未验证），导致登录 shell 的 PATH 把 shim 排在前面
- 用户终端 zsh 里 `which claude` → `/Users/yiminlin/.local/bin/claude`（真实路径），说明用户 zsh 的 PATH 设置正确，问题只在于 GUI 进程没继承这个 PATH

## Assumptions (temporary)

- 用户的 `$SHELL` 环境变量在 macOS GUI 进程里可用（launchd 通常会从用户 environment.plist 注入；未验证）
- detect 失败的根因是 PATH 解析顺序，不是 `which` 本身的问题
- 用户主要使用 macOS，Linux/Windows 暂为次要

## Open Questions

（全部已收敛——见 Decisions）

## Decisions

- **Q1（scope）= Option 1（修正）**：只改 detect 按钮（`CliSettings.tsx:106-117`）。version test 不依赖 PATH（`exec <cliPath> --version`），detect 修好它就跟着对；spawn 是独立热路径，留给后续 task。
- **Q2（platform）= Option C**：macOS + Linux + Windows 全平台。承认 Windows spawn 仍坏（spawn 不在本 task scope），本 task 只负责把 detect 三平台都能正确解析用户 shell 并 `which`/`where` 出真实路径。
- **Q3（shell 解析方式）= Option C**：统一 helper `buildAdapterDetectCommand(adapterId, adapterCmd)`（建议放 `@quill/cli-adapter`，与 `buildAdapterVersionCommand` 同位）。平台分支：
  - macOS：`exec "$(dscl . -read /Users/$(whoami) UserShell | awk '{print $2}')" -lc "which <cmd>"`
  - Linux：`exec "$(getent passwd $(whoami) | cut -d: -f7)" -lc "which <cmd>"`
  - Windows：`where <cmd>`（需新 sidecar，cmd.exe 或 PowerShell，见 capabilities 改动）
- **Q4（fallback）= Option A**：不显式 fallback。沿用 `output.code === 0 && detected` 才写的语义，helper 命令在 shell 解析失败时直接报错，整体 detect 失败，cliPaths 保持原值。
- **Q5（cmux 兜底）= Option A**：不加 cmux shim 过滤。C 方案走用户真实 shell 已解决根因；hardcode `cmux-cli-shims` 字符串是把第三方工具名刻进代码，未来 cmux 改名/换目录就要跟着改。

## Requirements

- detect 按钮在 macOS / Linux / Windows 三平台都通过用户**真实默认 shell**（不是 `/bin/sh`）跑 `which`（Unix）/ `where`（Windows）
- detect 返回的路径必须与用户在交互终端运行 `which <cmd>` / `where <cmd>` 一致
- 写入 `cliPaths` 的路径在系统重启后仍有效（不能是 `/var/folders/...` 临时 shim 路径）
- shell 解析失败或 `which`/`where` 返回空时，cliPaths 保持原值，不写脏数据（沿用 `output.code === 0 && detected` 语义）
- 不改 version test、ScriptRuntimesSettings、gitService、scriptRunner、claude/pi adapter spawn（这些 sidecar 调用点保持现状）
- Windows detect 用到的新 sidecar（cmd.exe）只服务 detect；其他 7 处 sidecar 调用点不动

## Acceptance Criteria

- [ ] macOS 上 detect 按钮返回 `~/.local/bin/claude`（或用户终端 `which claude` 真实结果），不再是 `/var/folders/.../cmux-cli-shims/...` 路径
- [ ] Linux 上 detect 返回用户真实 PATH 下解析的路径（通过 `getent passwd` 解析用户 shell 后 `which`），不会回退到 `/bin/sh` 上下文
- [ ] Windows 上 detect 走 `where <cmd>`（新 cmd.exe sidecar），返回真实 .exe 路径，不报"sidecar not found"
- [ ] 写入 cliPaths 的路径在系统重启后仍有效
- [ ] shell 解析失败（dscl/getent 报错、where 找不到）时不写 cliPaths，input 框保持原值
- [ ] version test 行为不变（仍 `exec <cliPath> --version`），detect 修好它自动跑真实路径
- [ ] 其他 6 处 sidecar 调用点（ScriptRuntimesSettings、gitService、scriptRunner、claude/pi spawn）行为不变

## Definition of Done

- helper `buildAdapterDetectCommand` 有单元测试覆盖三平台分支
- CliSettings 调用 helper 替换内联 `which ${adapterCmd}` 字符串
- capabilities JSON 新增 Windows cmd.exe sidecar（default.json + pet-panel.json）
- lint / typecheck / build green
- 用户在 macOS 上手动验证：detect → 真实路径 → test → 版本输出
- Linux/Windows 行为无法在 macOS CI 验证，文档化为"实现遵循平台规范但未在 CI 验证"

## Out of Scope (explicit)

- spawn 路径（`claudeAdapter.ts:143` / `piAdapter.ts:348`）改用户 shell —— 独立热路径，留给后续 task
- Windows spawn 整体修复（当前 `/bin/sh` sidecar 在 Windows 上完全不工作，detect 修好 spawn 还是坏的）—— 留给后续 task
- version test 命令构造改动（`buildAdapterVersionCommand` 不依赖 PATH，detect 修好自动对）
- cmux shim 路径过滤（C 方案走用户真实 shell 已解决根因）
- 显式 fallback 到 `/bin/sh -lc which`（Q4 = A，失败就失败）

## Technical Approach

**新增 helper**（`packages/cli-adapter/src/registry.ts` 或 `piAdapter.ts` 同位 `buildAdapterVersionCommand`）：

```ts
export function buildAdapterDetectCommand(adapterCmd: string): string {
  switch (process.platform) {
    case 'darwin':
      return `exec "$(dscl . -read /Users/$(whoami) UserShell | awk '{print $2}')" -lc "which ${adapterCmd}"`;
    case 'linux':
      return `exec "$(getent passwd $(whoami) | cut -d: -f7)" -lc "which ${adapterCmd}"`;
    case 'win32':
      return `where ${adapterCmd}`;
    default:
      return `which ${adapterCmd}`;
  }
}
```

**CliSettings.tsx 调用点**（line 106-117）替换为：
```ts
const cmd = Command.create('claude-cli', ['-l', '-c', buildAdapterDetectCommand(adapterCmd)]);
```

Windows 上 `Command.create` 改用新 sidecar name（如 `win-detect`），sidecar 定义 `cmd: "cmd.exe"`、`args: true`。

**capabilities JSON**：
- `apps/desktop/src-tauri/capabilities/default.json` 新增 `win-detect` sidecar（cmd.exe）
- `apps/desktop/src-tauri/capabilities/pet-panel.json` 同步

**Sidecar 调用点改动**：仅 `CliSettings.tsx:110` 这一处 detect 命令；Windows 走 `win-detect`，Unix 仍走 `claude-cli`。

## Decision (ADR-lite)

**Context**: Tauri GUI 进程的 PATH 与用户终端不同，`/bin/sh -lc which` 在 macOS 上命中 cmux shim 路径，写入 cliPaths 是定时炸弹。

**Decision**:
- Scope 最小化到 detect 按钮（Q1）
- 三平台显式支持（Q2）
- helper 平台分支：macOS `dscl` + `which`、Linux `getent` + `which`、Windows `where`（Q3）
- 失败不 fallback，沿用 "code===0 && detected 才写"（Q4）
- 不加 cmux shim 字符串过滤（Q5）

**Consequences**:
- ✅ macOS 根因解决，detect 返回真实路径
- ✅ Linux 跨发行版兼容（`getent` 通用）
- ⚠️ Windows detect 修好但 spawn 仍坏（半生不熟），用户点 Test/spawn 还是失败 —— 留给后续 task
- ⚠️ `dscl` / `getent` 失败时 detect 无反馈，UI 上 input 不变化 —— 用户需感知到失败
- ⚠️ Windows 新 sidecar 是首个平台分支 sidecar，为后续 Windows 全面支持埋下入口

## Research References

（本 task 决策全在 brainstorm 内完成，无需 trellis-research 子代理）

## Implementation Plan (single PR)

1. 在 `packages/cli-adapter/src/` 加 `buildAdapterDetectCommand` + 单元测试
2. 改 `CliSettings.tsx:110` 调用 helper（保留 `claude-cli` sidecar for Unix）
3. 加 Windows detect 分支：CliSettings 根据 `process.platform` 选 sidecar name（`win-detect` for win32，`claude-cli` otherwise）
4. capabilities JSON 加 `win-detect` sidecar（`cmd.exe` + `args: true`）到 default + pet-panel
5. lint / typecheck / build / test
6. 用户手动验证 macOS detect
