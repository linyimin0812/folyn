# PRD: Switch Windows bundle target to NSIS

## 背景
GitHub Actions release workflow 在 Windows runner 上 `pnpm tauri build` 时，WiX `light.exe` 静默失败（stderr 被 tauri-action 吞掉，日志里只有 `failed to run light.exe`），导致 MSI 产物无法生成、整个 Windows 发布流程中断。

candle 阶段已通过，问题在 light 链接 MSI。继续走 MSI 路线要么加 `--verbose` 反复跑 CI 抓错，要么绕开 WiX。Quill 无企业批量部署需求，不需要 MSI。

## 目标
把 Windows 打包目标从 `all`（msi+nsis）改为只产 NSIS，绕开 WiX/light.exe，让 CI 一次过。

## 改动范围
单文件：`apps/desktop/src-tauri/tauri.conf.json`

- `bundle.targets`：`"all"` → `["nsis"]`

不动：macOS target、icons、file associations、resources。

## 验证
- 本地不需要跑 Windows 打包（用户自己编译验证）。
- CI 触发 release workflow 后 Windows job 应产出 `Quill_0.1.0_x64-setup.exe` 而非 `.msi`。

## 非目标
- 不修复 MSI/WiX 路径 —— 如果未来需要 MSI 再单独处理。
- 不动 macOS / Linux 的 bundle 配置。
