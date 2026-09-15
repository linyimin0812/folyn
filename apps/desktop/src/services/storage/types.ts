/**
 * Storage provider abstraction — used by both the image-paste flow
 * (image hosting) and the markdown→HTML share flow (HTML hosting).
 *
 * A provider is a {@link StorageProviderEntry} registered in
 * `registry.ts`'s `StorageProviderRegistry`. Built-in R2/Qiniu/OSS register
 * at boot (`builtinStorageProviders.ts`); trusted extensions register through
 * the `storageProviderAdapter` contribution point. The two call sites
 * (`imageUploader.ts` for paste, `useExport.ts` for share) route through
 * `getProvider(id)` and never branch per provider.
 *
 * ponytail: no AuthSigner/Transport sub-interfaces. SigV4, HmacSHA1,
 * Bearer token and OAuth differ enough that an extra abstraction layer
 * becomes "interface with one implementation". Each provider owns its
 * signing privately; crypto helpers live in `crypto.ts` and are shared
 * at the function level (not the type level).
 */

// ─── Provider ids ──────────────────────────────────────────────────────

/** Discriminator for a provider's config. String, not literal union —
 *  custom ids (smms, imgur, oss, cos, …) flow through without a cast.
 *  Mirrors ChatProvider's `string` stance. */
export type StorageProviderId = string;

// ─── Capabilities ──────────────────────────────────────────────────────

export interface StorageProviderCapabilities {
  /** Provider accepts image uploads (paste/drop target). */
  image: boolean;
  /** Provider accepts HTML uploads (markdown→HTML share target). */
  html: boolean;
}

// ─── Built-in provider configs ──────────────────────────────────────────
//
// Each built-in provider owns its config shape. The host store holds configs
// as opaque `Record<string, unknown>` keyed by provider id; a provider narrows
// to its own type at the boundary (its `isConfigured` / `uploadImage` cast the
// `unknown` config). Extension providers own whatever shape they declare.

export interface R2ProviderConfig {
  provider: 'r2';
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** Public URL base prepended to object keys for the markdown/share URL.
   *  Either the r2.dev public subdomain (https://pub-xxx.r2.dev) or a
   *  custom domain bound to the bucket. */
  publicBaseUrl: string;
  imageKeyPrefix: string; // default 'images/'
  htmlKeyPrefix: string;   // default 'html/'
}

export type QiniuRegion = 'z0' | 'z1' | 'z2' | 'na0' | 'as0';

export interface QiniuProviderConfig {
  provider: 'qiniu';
  accessKey: string;
  secretKey: string;
  bucket: string;
  region: QiniuRegion;
  /** Bound custom domain, e.g. https://cdn.example.com. Qiniu requires
   *  a bound domain for public access; there's no qiniu-hosted default. */
  publicBaseUrl: string;
  imageKeyPrefix: string;
  htmlKeyPrefix: string;
}

export interface OssProviderConfig {
  provider: 'oss';
  accessKeyId: string;
  accessKeySecret: string;
  bucket: string;
  /** Bare OSS region without `oss-` prefix, e.g. `cn-hangzhou`. Endpoint
   *  hostname is built as `https://<bucket>.oss-<region>.aliyuncs.com`;
   *  V4 scope uses the bare form. User may enter either form in the UI
   *  — we normalize on save. */
  region: string;
  publicBaseUrl: string;
  imageKeyPrefix: string;
  htmlKeyPrefix: string;
}
