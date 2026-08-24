# Storage & Sharing — Provider-abstraction Layer

## Goal

在 Folyn 加一个 **存储与分享 settings tab**，配置对象存储凭据后同一份配置服务两个用途：

1. **图床**：粘贴/拖拽图片时选 provider target，返回公网 URL 写入文档
2. **HTML 托管（分享）**：把当前 markdown 文档转成 HTML 上传，得到公网分享 URL

抽象出一层 `StorageProvider` 接口，本次实现 R2 + 七牛两个 provider，但接口设计要让后续加 SM.MS / Imgur / OSS / COS 等 provider 时**只新增一个文件 + 注册一行**，不动核心流程。

R2/七牛本就是通用对象存储——同一份凭据 + bucket，不同 key 前缀服务两种用途是自然耦合。

## What I already know

- **栈**: Tauri 2 + React + TS + TipTap。HTTP 用原生 `fetch`，无 axios。
- **接入点已存在**: `apps/desktop/src/utils/imageUploader.ts` 有 `ImageUploadStrategy` 接口 + `LocalFileStrategy`（已用）+ `OssStrategy`/`CdnStrategy` stub。本次升级为 `StorageProvider` 抽象层。
- **触发流程**: 粘贴/拖拽 → `RichTextImage.tsx` 的 `imagePasteDropPlugin` → `RichTextEditor.tsx` 调 `ImagePasteDialog` → 用户选 target → `getStrategy(target).upload(...)` → 拿 `markdownUrl` 插文档。
- **HTML 导出钩子**: `apps/desktop/src/hooks/useExport.ts` 已有 `exportHtml()`；`apps/desktop/src/components/editor/ExportMenu.tsx:82` 调它。分享流程在此菜单加项 "Share to Cloud"。
- **HTML 内联图片**: `apps/desktop/src/services/export/shared.ts:137` `inlineContainerImages()` 已把容器内 `<img>` 的 Tauri asset URL 转 base64 data URI。
- **Settings 持久化套路**:
  - 普通 slice: `storageClient` (`~/.folyn/storage/<safe>.json`)
  - 密钥 slice: `aiConfigStore` 走 `~/.folyn/providers/<provider>.json`（隔离）—— 存储凭据应跟这条
- **Settings tab 注册**: `store/navStore.ts:7` `SettingsTab` union；slice 注册到 `settingsPersistence.ts` `EXPECTED_SLICES`。

## Decisions

- **(Q1) 签名**: 手写 SigV4 + HmacSHA1（用 `crypto.subtle`），不引 SDK
- **(Q2) HTML 内图片处理**: 双模式可配，默认 inline
  - inline 模式：复用现有 `inlineContainerImages()`，把所有本地 `<img>` 转 base64 data URI
  - upload 模式：逐个调 `provider.uploadImage(bytes, name)` 上传，重写 `<img src>` 为公网 URL
  - 配置项位置：全局开关（settings tab 里 `htmlImageMode: 'inline' | 'upload'`），不做 per-share 选择
- **(Q3) 分享 UX**: ExportMenu 加项 "Share to Cloud"，每次生成新 URL（`html/<sha1>.html`），URL 拷剪贴板 + toast。不做分享管理 UI。
- **(Q4) Provider 字段**:

  | Provider | 字段 |
  |----------|------|
  | **R2** | `accountId`、`accessKeyId`、`secretAccessKey`、`bucket`、`publicBaseUrl`、`imageKeyPrefix`（默认 `images/`）、`htmlKeyPrefix`（默认 `html/`） |
  | **七牛** | `accessKey`、`secretKey`、`bucket`、`region`（z0/z1/z2/na0/as0）、`publicBaseUrl`、`imageKeyPrefix`、`htmlKeyPrefix` |

  R2 endpoint = `https://<accountId>.r2.cloudflarestorage.com`；七牛上传域名按 region 算。
- **(Q5) bucket 公开访问**: 不主动探测。R2 默认私桶，用户必须自己开 "Public Development URL" 或绑自定义域名 + 设公开。上传成功但访问 403 时，toast 提示 "对象已上传但 bucket 未开放公开访问，请在控制台设置"。
- **(Q6) Settings tab 名**: `存储与分享`（i18n key `settings:tabs.storage`），图标 lucide `Cloud`。
- **(Q7) 抽象层**: 见 Technical Approach。

## Technical Approach — `StorageProvider` 抽象层

### 接口设计

```ts
// apps/desktop/src/services/storage/types.ts

/** 每个 provider 的能力声明 — 决定 UI 中是否显示某用途 */
export interface StorageProviderCapabilities {
  /** 支持作为图床（上传图片到 provider） */
  image: boolean;
  /** 支持托管 HTML（用于分享） */
  html: boolean;
}

/** Provider 配置 — discriminated union by provider id */
export type ProviderConfig =
  | { provider: 'r2'; accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string; publicBaseUrl: string; imageKeyPrefix: string; htmlKeyPrefix: string }
  | { provider: 'qiniu'; accessKey: string; secretKey: string; bucket: string; region: 'z0' | 'z1' | 'z2' | 'na0' | 'as0'; publicBaseUrl: string; imageKeyPrefix: string; htmlKeyPrefix: string }
  // 后续追加: | { provider: 'smms'; apiToken: string; ... }
  //          | { provider: 'imgur'; clientId: string; ... }
  //          | { provider: 'oss'; ... }
  //          | { provider: 'cos'; ... }
  ;

export interface StorageProvider {
  readonly id: string;                          // 'r2' | 'qiniu' | 'smms' | ...
  readonly label: string;                       // i18n key
  readonly icon: string;                        // lucide name or emoji
  readonly capabilities: StorageProviderCapabilities;
  /** 此 provider 的凭据是否已配置（控制 UI 是否灰态） */
  isConfigured(config: ProviderConfig | null): config is Extract<ProviderConfig, { provider: string }>;
  /** 上传图片 bytes，返回公网 URL（仅当 capabilities.image = true） */
  uploadImage(bytes: Uint8Array, ext: string, config: Extract<ProviderConfig, { provider: string }>): Promise<string>;
  /** 上传 HTML 字符串，返回公网 URL（仅当 capabilities.html = true） */
  uploadHtml(html: string, config: Extract<ProviderConfig, { provider: string }>): Promise<string>;
}
```

### Registry

```ts
// apps/desktop/src/services/storage/registry.ts
import type { StorageProvider } from './types';
import { R2Provider } from './providers/r2';
import { QiniuProvider } from './providers/qiniu';

const providers: StorageProvider[] = [new R2Provider(), new QiniuProvider()];

export function getAllProviders(): StorageProvider[] { return providers; }
export function getProvider(id: string): StorageProvider {
  const p = providers.find(p => p.id === id);
  if (!p) throw new Error(`Unknown storage provider: ${id}`);
  return p;
}
```

新增 provider = 新文件 `providers/<id>.ts` 实现 `StorageProvider` + 在 `registry.ts` 加一行。**不碰调用方代码。**

### 文件结构

```
apps/desktop/src/services/storage/
├── types.ts           # StorageProvider 接口 + ProviderConfig union
├── registry.ts        # getAllProviders / getProvider
├── crypto.ts          # SigV4 + HmacSHA1 工具（共享）
├── providers/
│   ├── r2.ts          # R2Provider 实现
│   └── qiniu.ts       # QiniuProvider 实现
└── __tests__/
    └── crypto.test.ts # SigV4 fixture / HmacSHA1 vector 自检
```

### 调用方接线

1. **图床流程**：`apps/desktop/src/utils/imageUploader.ts` 的 `OssStrategy`/`CdnStrategy` 删除，改 delegating 到 `getProvider(config.provider).uploadImage(...)`。`ImageUploadStrategy` 接口保留（兼容现有 dialog），但内部委托 storage 层。
2. **HTML 分享流程**：`useExport.ts` 加 `shareToCloud()` 方法 → 走 `exportHtml()` 拿 HTML → 按 `htmlImageMode` 处理图片（inline 或 upload+rewrite）→ 调 `getProvider(config.provider).uploadHtml(html, config)` → 拿 URL 拷剪贴板 + toast。ExportMenu 加项触发。
3. **Settings tab**：新 `StorageSharingSettings.tsx`，根据 `getAllProviders()` 渲染每个 provider 的表单（字段由 `ProviderConfig` union 的 discriminated tag 决定）。

### 不做的抽象

- 不做 `AuthSigner` / `Transport` 子接口分解：不同 provider 签名模型差异巨大（SigV4 vs HmacSHA1 vs Bearer token vs OAuth），强行抽象会引入"interface with one implementation"的坏味道。每个 provider 独立完整实现 `uploadImage` / `uploadHtml`，签名逻辑各自私有。
- 不做 `ConfigSchema` 元描述驱动表单：每个 provider 表单手写一份 React 组件，更可读、调试直接。表单数量增长后再考虑。

## Requirements

- [ ] `StorageProvider` 接口 + registry
- [ ] `crypto.ts` SigV4 + HmacSHA1 工具 + 自检测试
- [ ] `R2Provider` 实现（image + html）
- [ ] `QiniuProvider` 实现（image + html）
- [ ] 新增 `storage` settings tab + 持久化 slice（凭据存 `~/.folyn/image-hosts/<provider>.json`）
- [ ] `ImageUploadStrategy` 委托 storage 层（删除 OssStrategy/CdnStrategy stub）
- [ ] ExportMenu "Share to Cloud" 项 + `shareToCloud()` 流程
- [ ] HTML 图片 inline/upload 双模式 + 全局开关
- [ ] dialog 自动渲染新 provider tab（沿用 `getAllStrategies()` 但 delegate）

## Acceptance Criteria

- [ ] 配置好 R2 凭据 → dialog 显示 R2 tab 可点；粘贴图片 → `![](https://<r2-public>/images/<sha1>.png)`
- [ ] 配置好七牛凭据 → dialog 显示七牛 tab 可点；粘贴图片 → `![](https://<qiniu-public>/images/<sha1>.png)`
- [ ] 未配置凭据 → tab 灰态 "coming soon"（沿用现有 `!enabled` 样式）
- [ ] ExportMenu "Share to Cloud" → 上传 HTML → 剪贴板拷 `https://<public>/html/<sha1>.html` + toast
- [ ] inline 模式（默认）：分享的 HTML 内本地图片变 base64，单文件自包含
- [ ] upload 模式：分享的 HTML 内本地图片被上传 + src 重写为公网 URL
- [ ] 网络失败/签名错误/403 有可读 toast
- [ ] SigV4 fixture + HmacSHA1 vector 测试通过

## Definition of Done

- crypto 工具自检测试 + 至少一个端到端手测（R2 真实凭据）
- lint / typecheck 通过
- 凭据不写入 git，不写入普通 storage JSON

## Out of Scope (explicit)

- 其他 provider 实现（SM.MS / Imgur / OSS / COS）—— 接口预留，不实现
- 图床迁移（已存在的本地图片 → 一键转 R2/Qiniu）
- 分享管理 UI（已分享列表、删除）
- 删除文档中的图片时同步从 bucket 删除
- 已分享 URL 的访问统计/有效期
- 图床上传的图片在 markdown 预览中的特殊渲染（http URL 走 `isLoadableUrlScheme` pass-through，已是现有行为）

## Technical Notes

- 关键文件：
  - `apps/desktop/src/utils/imageUploader.ts` (接入点，需委托到 storage 层)
  - `apps/desktop/src/components/editor/ImagePasteDialog.tsx` (UI tab)
  - `apps/desktop/src/components/editor/ExportMenu.tsx:82` (分享触发点)
  - `apps/desktop/src/hooks/useExport.ts` (HTML 生成 + 分享流程接入)
  - `apps/desktop/src/services/export/shared.ts:137` (inlineContainerImages 复用)
  - `apps/desktop/src/store/navStore.ts:7` (SettingsTab)
  - `apps/desktop/src/store/settingsPersistence.ts` (slice 注册)
  - `apps/desktop/src/store/aiConfigStore.ts` (凭据存储范式)
  - `apps/desktop/src/utils/storageClient.ts` (普通配置存储)
- R2 文档: https://developers.cloudflare.com/r2/api/s3/api/
- 七牛上传 API: https://developer.qiniu.com/kodo/1272/form-upload (PUT 上传 + HmacSHA1 token)
- AWS SigV4 reference: https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html
- crypto.subtle 支持 HMAC-SHA256/SHA1，可在主线程或 worker 用
