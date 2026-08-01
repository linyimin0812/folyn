# Vault 支持 GitHub 类型(git clone)与 git 操作入口

## Goal

让新建 Vault 支持 GitHub 类型（公开 + 私有仓库）。创建时 `git clone` 仓库到本地，后续所有文件读写基于 clone 后的本地文件（复用现有本地文件操作链路）。若当前 Vault 是 git 仓库，在左下角设置图标上方加一个 git 图标，用于 git 相关操作。

## What I already know

* `packages/vault-provider` 已有 provider 抽象：`VaultProvider` 接口、`VaultProviderRegistry`（工厂注册）、`VaultManager`（代理文件操作）。
* `ProviderType` 已包含 `'github'`（types.ts:2），但 `registry.ts` 只注册了 `tauri`，**没有 githubProvider 实现**。
* `TauriVaultProvider` 处理本地文件（read/write/list/rename/delete），`connect()` 时展开 `~` 并确保目录存在。所有文件操作走 `@tauri-apps/plugin-fs`。
* `vaultStore.addVault()`：构建 `VaultConfig` → `manager.switchVault(config)`（create provider + connect）→ `createDir('')` → `refreshFileTree` → seedAgentFiles → 持久化。`VaultConfig` 有 `options?: Record<string, unknown>` 可放 git/token 信息。
* `vaultStore.startWatcherForVault()` 目前只对 `providerType === 'tauri'` 启 watcher —— github vault clone 后也是本地目录，watcher 应同样生效。
* `CreateVaultDialog.tsx`：当前只有 `tauri` 一种 provider 选项，`PROVIDER_OPTIONS` 写死。basePath 默认从 name 派生。
* `ActivityBar.tsx`：左侧竖条，底部 `flex-1` spacer 后是 settings 齿轮图标。git 图标插在 settings 之上 = 放在 spacer 之后、settings 之前。
* Tauri 已带 `tauri-plugin-shell`，capabilities 里已有 `claude-cli`/`pi-cli` 两个 `/bin/sh` 作用域（`args: true`），可直接 `spawn('/bin/sh', ['-c', 'git ...'])` 跑 git，无需新增 capability（也可加专用 git scope 更干净）。
* `VaultConfig.options` 已是 `Record<string, unknown>` —— PAT/url/分支等可放这里，但会随 `storageClient` 明文持久化到 DB（安全考量）。

## Assumptions (temporary)

* git 已安装在用户机器上（clone/push/pull 通过 shell 调 `git`）。
* githubProvider 本质 = clone on connect + 复用本地文件操作（组合/继承 TauriVaultProvider），而非重新实现一套远程 git 文件 API。
* 私有仓库用 HTTPS + Personal Access Token（PAT），clone URL 形如 `https://<token>@github.com/owner/repo.git`。SSH 留作后续。
* git 图标只在「当前 vault 是 git 仓库」时显示，点击打开 git 操作面板。

## Decisions (ADR-lite)

* **git 操作范围**：status / pull / commit+push（MVP）。分支切换/merge/PR/diff UI 留后续。
* **鉴权**：HTTPS+PAT 优先，SSH 作为可选（SSH URL 复用本机 ssh-agent，免存 token）。
* **PAT 存储**：随 `VaultConfig.options` 明文持久化到本地 DB（零依赖；`.git/config` 本就有 token 暴露面，keychain 作后续加固）。
* **git 图标显示条件**：仅 `providerType === 'github'` 的 vault 显示。

## Open Questions

* （全部已解决，见 Decisions）

## Requirements

* 新建 Vault 弹窗增加 GitHub 类型选项；选择后输入：
  * repo URL + 鉴权方式（HTTPS+PAT / SSH）。HTTPS 公开 repo 不需 PAT，私有需 PAT；SSH 依赖本机 ssh-agent 免 PAT。
  * **分支策略**（配置项）：
    * `默认分支`：clone 仓库 default branch（主干），tracking 由 clone 自动设好。
    * `新建分支`：clone 后 `git checkout -b <分支名>`，需填分支名。
  * 分支策略存入 `VaultConfig.options.branchStrategy`。
* 创建流程：clone 仓库到本地目标目录 → 用本地文件 provider 接管 → 刷新文件树。
  * 重连（目录已存在且含 `.git`）：**不重 clone**，直接打开本地，避免覆盖本地改动；pull 交给 git 图标。
  * 目标目录非空且非 git 仓库：clone 失败，弹窗报错。
  * 鉴权失败（token 错/无权限）：clone 失败，错误信息透传到弹窗。
* PAT 随 `VaultConfig.options` 持久化（明文本地 DB）。
* `githubProvider` 注册到 registry；内部组合 `TauriVaultProvider` 做文件操作（clone 只在 connect 时按需执行一次）。
* `vaultStore` 的 watcher 适配：github vault clone 后也是本地目录，watcher 应同样生效（放开 `startWatcherForVault` 的 provider 限制）。
* git 操作（点击 git 图标的面板）：**status / pull / commit+push**。
  * 分支策略：**跟随当前分支**，不写死主干。clone 时 checkout 仓库 default branch；pull/commit+push 都作用于当前分支（`git pull` / `git push` 不带分支参数 = 推/拉当前分支 upstream），避免误动 main。
  * status：显示 `git status --short` 输出。
  * pull：`git pull`；有未提交改动导致冲突时报错，不自动 stash/merge。
  * commit+push：提交信息输入框 → `git add -A && git commit -m "<msg>" && git push -u origin HEAD`。`-u origin HEAD` 已设上游时为空操作、新分支首次 push 时自动设上游，一条命令覆盖「默认分支」与「新建分支」两种配置；未配 `user.name/email` 时原样抛错提示。
* git 图标仅在当前 vault `providerType === 'github'` 时显示，位于 ActivityBar 设置图标上方。

## Acceptance Criteria

* [ ] 新建 Vault 可选 GitHub 类型，填公开 repo URL + HTTPS 成功 clone 并打开。
* [ ] 私有 repo URL + PAT（HTTPS）可成功 clone。
* [ ] SSH 鉴权（本机已配 ssh-agent）可成功 clone。
* [ ] 新建 GitHub vault 选「新建分支」+ 分支名 → clone 后 checkout 新分支，commit+push 首次自动 `push -u origin HEAD` 设上游。
* [ ] 选「默认分支」→ clone 出 default branch，push 到其 upstream。
* [ ] clone 后的文件读写/创建/删除与本地 vault 行为一致（复用 Tauri provider）。
* [ ] 重启后重连已 clone 的 github vault：不再 clone，直接读本地文件。
* [ ] 目标目录非空且非 git 仓库时，clone 失败并提示。
* [ ] 鉴权失败时错误信息透传到弹窗。
* [ ] github vault 切换时 watcher 正常启动。
* [ ] 当前 vault 为 github 类型时，左下角设置图标上方出现 git 图标；非 github vault 不显示。
* [ ] git 图标面板：status 显示 `git status --short`；pull 成功拉取；commit+push 输入信息后提交并推送；未配 git identity 时报错提示。

## Definition of Done (team quality bar)

* Tests added/updated（provider clone 行为可 mock shell 验证；ActivityBar git 图标渲染条件）。
* Lint / typecheck / vitest green。
* 行为变更说明（新建 vault 多了一种类型、新增 git 入口）。

## Out of Scope (explicit)

* 多分支切换 / merge / diff UI / PR & Issue 管理 / git history 可视化。
* keychain 加密存储 PAT（与 credential helper 配合避免写 `.git/config`）。
* 其它 provider（webdav/s3/custom）。
* clone 进度条（仅 loading 态「克隆中...」）。
* pull 冲突自动 stash/merge（仅报错）。

## Technical Notes

* 关键文件：
  * `packages/vault-provider/src/providers/tauriProvider.ts`（复用）
  * `packages/vault-provider/src/providers/githubProvider.ts`（新建，组合 Tauri）
  * `packages/vault-provider/src/registry.ts`（注册 github）
  * `apps/desktop/src/store/vaultStore.ts`（addVault 流程、watcher 适配）
  * `apps/desktop/src/components/vault/CreateVaultDialog.tsx`（GitHub 选项 + URL/PAT 输入）
  * `apps/desktop/src/components/shell/ActivityBar.tsx`（git 图标）
  * `apps/desktop/src-tauri/capabilities/default.json`（git shell scope，如需）
* Tauri shell plugin 调用方式：`import { Command } from '@tauri-apps/plugin-shell'; new Command('claude-cli', ['-c', 'git clone ...'])` 或新增 `git` scope。
