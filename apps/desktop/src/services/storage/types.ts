/**
 * Storage provider abstraction — used by both the image-paste flow
 * (image hosting) and the markdown→HTML share flow (HTML hosting).
 *
 * Adding a new provider = new file under `providers/` implementing
 * `StorageProvider` + one line in `registry.ts`. The two call sites
 * (`imageUploader.ts` for paste, `useExport.ts` for share) do not change.
 *
 * ponytail: no AuthSigner/Transport sub-interfaces. SigV4, HmacSHA1,
 * Bearer token and OAuth differ enough that an extra abstraction layer
 * becomes "interface with one implementation". Each provider owns its
 * signing privately; crypto helpers live in `crypto.ts` and are shared
 * at the function level (not the type level).
 */

// ─── Provider ids ──────────────────────────────────────────────────────

/** Discriminator for `ProviderConfig`. String, not literal union —
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

// ─── Provider config (discriminated union) ─────────────────────────────

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

// ponytail: discriminated union by `provider`. Adding a new provider =
// adding a new member here + a new file under providers/. TS narrows
// in switch (cfg.provider) so each provider's upload gets its own
// correctly-typed config without casts at the call site.
export type ProviderConfig = R2ProviderConfig | QiniuProviderConfig;

// ─── StorageProvider interface ─────────────────────────────────────────

export interface StorageProvider {
  readonly id: StorageProviderId;
  /** i18n key, e.g. 'settings:storage.providers.r2.label'. */
  readonly labelKey: string;
  /** lucide icon name or single emoji. */
  readonly icon: string;
  readonly capabilities: StorageProviderCapabilities;

  /** Type guard: is this config populated enough to attempt an upload?
   *  Controls whether the UI shows the provider as enabled or "coming soon". */
  isConfigured(config: ProviderConfig | null): boolean;

  /** Upload image bytes. Caller verifies capabilities.image before calling.
   *  Returns the public https URL to insert into markdown. */
  uploadImage(
    bytes: Uint8Array,
    ext: string,
    config: ProviderConfig,
  ): Promise<string>;

  /** Upload an HTML string. Caller verifies capabilities.html before calling.
   *  Returns the public https URL to share. */
  uploadHtml(
    html: string,
    config: ProviderConfig,
  ): Promise<string>;
}

// ─── Type guards ────────────────────────────────────────────────────────

export function isR2Config(c: ProviderConfig | null | undefined): c is R2ProviderConfig {
  return !!c && c.provider === 'r2';
}

export function isQiniuConfig(c: ProviderConfig | null | undefined): c is QiniuProviderConfig {
  return !!c && c.provider === 'qiniu';
}
