# Vault 双向同步与冲突解决

## Goal

为 Mochi 落地真正的双向同步引擎：在本地 FS（Tauri provider）与远端对象存储（S3 兼容 / WebDAV / GitHub）之间做双向同步，包含变更检测、远端 diff、pull/push、冲突解决与可选 E2E 加密。当前 `settingsStore` 里有完整 sync 配置（`syncMethod / syncEndpoint / syncAccessKey / syncSecretKey / syncBucket / autoSync / e2eEncrypt`），但 `apps/desktop/src` 下**没有任何同步引擎实现**，`SettingsPage` 也没有渲染 sync 区块——同步目前是个"设置存了但无引擎、无 UI 入口"的空壳。

## What I already know

- `settingsStore` 已有 sync 字段（S3-flavored：endpoint/access/secret/bucket + autoSync + e2eEncrypt），默认 `syncMethod: 'S3 兼容（R2 / MinIO）'`。`SettingsTab` 含 `'sync'`，但 `SettingsPage.tsx` 未渲染任何 sync 控件（grep 无命中）。
- `@mochi/vault-provider` 定义了 `VaultProvider` 接口（`readFile/writeFile/deleteFile/listFiles/createDir/deleteDir/rename`，可选 `search/getHistory/watch/getMetadata`），有 5 个 provider：`tauri/github/webdav/s3`（+ base）。**接口是单文件 CRUD 级，没有任何 sync/diff/merge 能力**——同步引擎必须位于 provider 层之上，编排两个 provider（local + remote）。
- `VaultMetadata { path, size, lastModified: Date, etag? }` 已有，可用于变更检测；S3 天然有 ETag/LastModified，WebDAV 有 `getlastmodified`，GitHub 有 `sha`，local 有 mtime（Tauri fs stat）。
- 本地变更检测已解决：`apps/desktop/src/utils/fileWatcher.ts` 用 `@tauri-apps/plugin-fs` 的 `watch`，已有 `suppressWatcherFor` / `pauseWatcher` / `resumeWatcher` 钩子，写路径会用它避免回环。
- 同步目标拓扑（推断）：单用户、多设备，每设备本地一份 vault，远端一个对象存储做汇聚。不是 realtime 多人协作。
- `VaultCapabilities` 有 `history/offline` 等位，但目前无 provider 真正实现 `getHistory`。

## Assumptions (temporary, to validate)

- MVP 远端后端以 **S3 兼容**为主（与现有 settings 字段对齐），WebDAV/GitHub 可作为后续。
- 同步粒度为**整文件级**（markdown/文本），不做行级 CRDT。
- 冲突策略倾向**安全 > 自动**：冲突时产生冲突副本 + 提示用户，不做激进自动三方合并（待研究确认）。
- E2E 加密为**可选开关**，开启时本地加密后上传、远端只见密文。

## Open Questions

- MVP 支持哪些远端后端？（S3 only / +WebDAV / +GitHub）
- 冲突解决策略偏好？（冲突副本 / 三方文本合并 / LWW）
- 触发方式？（仅手动 / autoSync 定时 / 本地变更即时 debounce push + 远端定时 pull）

## Requirements (evolving)

- 同步引擎服务（renderer 侧，编排 local+remote provider），不污染 `BaseCliAdapter` 与 AI 消费者。
- 本地变更检测复用 `fileWatcher`；远端变更检测基于 metadata（etag/lastModified/size）。
- pull / push / 双向同步，含创建/修改/删除传播（含重命名最佳努力）。
- 冲突解决：TBD（待研究 + 用户偏好）。
- 可选 E2E 加密：开启后远端只存密文。
- 同步状态可见（进行中/完成/冲突数），冲突需 UI 入口。
- `SettingsPage` 渲染 sync 区块，连通引擎。

## Acceptance Criteria (evolving)

- [ ] 配置 S3 兼容后端后，能完成一次完整的双向同步（local↔remote）。
- [ ] 本地新建/修改/删除文件能 push 到远端；远端新建/修改/删除能 pull 回本地。
- [ ] 同步冲突产生可识别的冲突副本（或所选策略的等价产物），不丢数据。
- [ ] 开启 E2E 时，远端对象为密文，另一设备用相同密钥可解密还原。
- [ ] 同步状态在 UI 可见；冲突有处理入口。
- [ ] 单元测试覆盖：变更检测、diff 计算、冲突判定、加解密 round-trip。

## Definition of Done

- Tests added/updated（engine 纯逻辑可单测，无网；provider 集成用 mock 或 sandbox）。
- Lint / typecheck / CI green。
- Settings sync UI 区块落地；行为变化在 README/AGENTS 注明。
- 回滚：同步引擎为新增模块，不破坏现有单 provider 路径；可禁用。

## Out of Scope (explicit)

- 多人 realtime 协同编辑（CRDT/Operational Transform）。
- 行级/字符级合并（如确需文本合并，限制在文件级 three-way）。
- 移动端（Tauri mobile）适配——属另一路线图项。
- 历史版本回溯 UI（属"版本历史"独立任务）。

## Technical Notes

- 同步引擎位置：`apps/desktop/src/services/syncEngine.ts`（新增），消费 `@mochi/vault-provider` 的 `VaultManager`/`VaultProvider`，被 `settingsStore.autoSync` 与 `SettingsPage` 驱动。
- 本地侧：`TauriVaultProvider` + 现有 `fileWatcher`。
- 远端侧：`S3VaultProvider`（已有），WebDAV/GitHub 视 MVP 范围。
- 加密：renderer 侧 WebCrypto（`SubtleCrypto` AES-GCM）即可，key 派生用 PBKDF2 over 用户口令；待研究确认库与方案。
- 冲突元数据：可能需要本地 sidecar（如 `.mochi/sync-state.json`）记录 last-synced 远端 etag/mtime per path。

## Research References

- [`research/sync-engine-patterns.md`](research/sync-engine-patterns.md) — TODO：同类工具（Obsidian Sync/Syncthing/working-copy/git）的双向同步与冲突策略。
- [`research/e2e-encryption-for-sync.md`](research/e2e-encryption-for-sync.md) — TODO：对象存储同步的端到端加密方案与库选型。
- [`research/remote-change-detection.md`](research/remote-change-detection.md) — TODO：S3/WebDAV 远端变更检测与增量同步策略。
