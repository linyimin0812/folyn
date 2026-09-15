/**
 * Register the built-in storage providers (R2 / Qiniu / OSS) into the
 * {@link StorageProviderRegistry} at boot. Each entry bundles the provider's
 * signing/upload logic with its extracted config form + default config — the
 * same shape a trusted extension contributes via `storageProviderAdapter`.
 *
 * Imported for its side effect where other storage bootstraps run, so the
 * providers exist before the Settings UI or upload call sites look them up.
 */
import { storageProviderRegistry, type StorageProviderEntry } from './registry';
import { R2Provider } from './providers/r2';
import { QiniuProvider } from './providers/qiniu';
import { OssProvider } from './providers/oss';
import { R2Form } from './forms/R2Form';
import { QiniuForm } from './forms/QiniuForm';
import { OssForm } from './forms/OssForm';
import { defaultR2Config, defaultQiniuConfig, defaultOssConfig } from './storageConfigStorage';

const r2 = new R2Provider();
const qiniu = new QiniuProvider();
const oss = new OssProvider();

const builtins: StorageProviderEntry[] = [
  {
    id: r2.id,
    labelKey: r2.labelKey,
    icon: r2.icon,
    capabilities: r2.capabilities,
    defaultConfig: defaultR2Config(),
    configForm: R2Form,
    isConfigured: (cfg) => r2.isConfigured(cfg),
    uploadImage: (bytes, ext, cfg) => r2.uploadImage(bytes, ext, cfg),
    uploadHtml: (html, cfg) => r2.uploadHtml(html, cfg),
  },
  {
    id: qiniu.id,
    labelKey: qiniu.labelKey,
    icon: qiniu.icon,
    capabilities: qiniu.capabilities,
    defaultConfig: defaultQiniuConfig(),
    configForm: QiniuForm,
    isConfigured: (cfg) => qiniu.isConfigured(cfg),
    uploadImage: (bytes, ext, cfg) => qiniu.uploadImage(bytes, ext, cfg),
    uploadHtml: (html, cfg) => qiniu.uploadHtml(html, cfg),
  },
  {
    id: oss.id,
    labelKey: oss.labelKey,
    icon: oss.icon,
    capabilities: oss.capabilities,
    defaultConfig: defaultOssConfig(),
    configForm: OssForm,
    isConfigured: (cfg) => oss.isConfigured(cfg),
    uploadImage: (bytes, ext, cfg) => oss.uploadImage(bytes, ext, cfg),
    uploadHtml: (html, cfg) => oss.uploadHtml(html, cfg),
  },
];

let registered = false;

/** Register built-in storage providers. Idempotent — safe to call once at boot. */
export function registerBuiltinStorageProviders(): void {
  if (registered) return;
  registered = true;
  for (const entry of builtins) storageProviderRegistry.register(entry);
}

registerBuiltinStorageProviders();
