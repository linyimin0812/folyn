# Integrate Cloudflare R2 and Qiniu Image Hosting

## Goal

让 Quill 支持把粘贴/拖拽进来的图片上传到 Cloudflare R2 或七牛云对象存储，返回公网 URL 写入文档（替代当前只写本地 vault 的 LocalFileStrategy）。

## What I already know

- **栈**: Tauri 2 + React + TS + TipTap。HTTP 用原生 `fetch`，无 axios。
- **接入点已存在**: `apps/desktop/src/utils/imageUploader.ts` 有 `ImageUploadStrategy` 接口 + `LocalFileStrategy`（已用）+ `OssStrategy`/`CdnStrategy` stub（`enabled: false`，抛"暂未实现"）。
- **触发流程**: 粘贴/拖拽 → `RichTextImage.tsx` 的 `imagePasteDropPlugin` → `RichTextEditor.tsx` 弹 `ImagePasteDialog` → 用户选 target → `getStrategy(target).upload(base64, config, vaultRoot, filePath)` → 拿 `markdownUrl` 插文档。
  - 注：`RichTextImage.tsx` 还有一条**绕过对话框**的 fast path `persistImageBytes`（直接写 vault），但只在 dialog 未挂时生效。
- **Settings 持久化套路**:
  - 普通 slice: `storageClient` (`~/.quill/storage/<safe>.json`)
  - 密钥 slice: `aiConfigStore` 走 `~/.quill/providers/<provider>.json`（带 base64/隔离）—— R2/Qiniu 密钥应跟这条
- **Settings tab 注册**: `store/navStore.ts:7` `SettingsTab` union；slice 注册到 `settingsPersistence.ts` `EXPECTED_SLICES`。

## Assumptions (temporary)

- R2 用 S3-compatible API + AWS SigV4 自签（不引 SDK，用 `crypto.subtle` 做 HMAC-SHA256）
- 七牛走原生 PUT 上传 + HmacSHA1 签名（不引 SDK，手写 base64/HmacSHA1）
- 对象 key 用 sha1 hash 命名（复用现有 `persistImageBytes` 的 content-addressed 思路）
- 配置 UI 是一个新的 `images` settings tab，含 R2 / 七牛两个表单

## Open Questions

- **(Q1 待问) Provider slot 设计**: 替换现有 `OssStrategy`/`CdnStrategy` 两个 stub 改名为 `R2Strategy`/`QiniuStrategy`，还是新增 `'r2' | 'qiniu'` 到 `UploadTarget` union？替换改动小但语义绑定。
- **(Q2 待问) 公网访问 URL 来源**: R2 用 r2.dev 公开子域名 vs 用户自定义域名；七牛必须绑定自定义域名 —— 是否每 provider 配一个 `publicBaseUrl` 字段？
- **(Q3 待问) 签名实现策略**: 手写 SigV4 / Qiniu 签名 vs 引入 `@aws-sdk/client-s3` / `qiniu-js`。手写省依赖、可控；SDK 省事但增加体积。
- **(Q4 待问) 失败回退**: 上传失败时 fallback 到本地 vault，还是直接报错让用户重试？

## Requirements (evolving)

- [ ] 实现 `R2Strategy` 和 `QiniuStrategy`，`enabled` 由"是否已配置凭据"决定
- [ ] 新增 image-hosting settings 页：R2 / 七牛两个表单，凭据存独立 secret 文件
- [ ] dialog 自动渲染两个新 strategy tab（已有逻辑遍历 `getAllStrategies()`）
- [ ] 上传成功后 markdownUrl 返回公网 https URL

## Acceptance Criteria (evolving)

- [ ] 配置好 R2 凭据后，dialog 显示 R2 tab 为可点；粘贴图片 → 文档中插入 `![](https://<r2-public-domain>/<sha1>.png)`
- [ ] 配置好七牛凭据后，dialog 显示七牛 tab 为可点；粘贴图片 → 文档中插入七牛公网 URL
- [ ] 未配置凭据时，两个 tab 显示 "coming soon" 灰态（沿用 `!strategy.enabled` 样式）
- [ ] 网络失败/签名错误有可读 toast 提示

## Definition of Done

- 单元/集成测试（签名构造是核心非平凡逻辑，至少一个 runnable check 验证签名格式）
- lint / typecheck 通过
- 凭据不写入 git，不写入普通 storage JSON

## Out of Scope (explicit)

- 图床迁移（已存在的本地图片 → 一键转 R2/Qiniu）
- 其他 provider（SM.MS / Imgur / OSS / COS）—— 接口预留但不实现
- 删除文档中的图片时同步从 bucket 删除（生命周期单独治理）
- 图床上传的图片在 markdown 预览中的特殊渲染（http URL 走 `isLoadableUrlScheme` pass-through，已是现有行为）

## Technical Notes

- 关键文件：
  - `apps/desktop/src/utils/imageUploader.ts` (接入点)
  - `apps/desktop/src/components/editor/ImagePasteDialog.tsx` (UI tab)
  - `apps/desktop/src/components/file-types/rich-text/RichTextEditor.tsx:135-160` (调用点)
  - `apps/desktop/src/components/work-area/EditorPane.tsx:159` (另一调用点)
  - `apps/desktop/src/store/navStore.ts:7` (SettingsTab)
  - `apps/desktop/src/store/settingsPersistence.ts` (slice 注册)
  - `apps/desktop/src/store/aiConfigStore.ts` (凭据存储范式)
  - `apps/desktop/src/utils/storageClient.ts` (普通配置存储)
- R2 文档: https://developers.cloudflare.com/r2/api/s3/api/
- 七牛上传 API: https://developer.qiniu.com/kodo/1272/form-upload (PUT 上传 + HmacSHA1 token)
- crypto.subtle 支持 HMAC-SHA256/SHA1，可在主线程或 worker 用
