/**
 * Qiniu Kodo storage provider.
 *
 * Upload: POST multipart/form-data to https://up<region>.qiniup.com
 * Alternative: PUT form upload via the older resumable API.
 *
 * ponytail: the simpler path is PUT-form upload to the upload endpoint
 * with `key=<objectKey>` + `token=<uploadToken>` + file payload. Returns
 * `{"key":"..."}` JSON. No multipart boundary wrangling.
 *
 * Reference: https://developer.qiniu.com/kodo/1272/form-upload
 */
import type { ProviderConfig, QiniuProviderConfig, StorageProvider } from '../types';
import { buildQiniuUploadToken, sha1Hex } from '../crypto';
import { isQiniuConfig } from '../types';
import { contentTypeForExt } from '../contentType';

// ponytail: region→upload host map. Region naming follows Qiniu docs.
// na0 = North America, as0 = Southeast Asia / Oceania. z0=East China,
// z1=North China, z2=South China.
const UPLOAD_HOST: Record<QiniuProviderConfig['region'], string> = {
  z0: 'https://up.qiniup.com',
  z1: 'https://up-z1.qiniup.com',
  z2: 'https://up-z2.qiniup.com',
  na0: 'https://up-na0.qiniup.com',
  as0: 'https://up-as0.qiniup.com',
};

function joinKey(prefix: string, key: string): string {
  const p = prefix.replace(/^\/+|\/+$/g, '');
  const k = key.replace(/^\/+/, '');
  return p ? `${p}/${k}` : k;
}

function publicUrl(cfg: QiniuProviderConfig, objectKey: string): string {
  const base = cfg.publicBaseUrl.replace(/\/+$/, '');
  return `${base}/${objectKey}`;
}

async function postForm(
  cfg: QiniuProviderConfig,
  objectKey: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<void> {
  const host = UPLOAD_HOST[cfg.region];
  const token = await buildQiniuUploadToken(
    cfg.accessKey,
    cfg.secretKey,
    cfg.bucket,
    objectKey,
    Date.now() / 1000 + 3600,
  );

  // ponytail: FormData works in Tauri webview; fetch serializes
  // multipart with a random boundary. We don't construct it by hand.
  // File name doesn't matter — the `key` field dictates storage path.
  const blob = new Blob([bytes as BlobPart], { type: contentType });
  const form = new FormData();
  form.append('key', objectKey);
  form.append('token', token);
  form.append('file', blob, 'payload');

  const res = await fetch(host, { method: 'POST', body: form });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const trimmed = text.length > 200 ? text.slice(0, 200) + '…' : text;
    throw new Error(`Qiniu upload failed: ${res.status} ${res.statusText} ${trimmed}`);
  }
}

export class QiniuProvider implements StorageProvider {
  readonly id = 'qiniu';
  readonly labelKey = 'settings:storage.provider.qiniu.label';
  readonly icon = '🐄';
  readonly capabilities = { image: true, html: true };

  isConfigured(config: ProviderConfig | null): config is QiniuProviderConfig {
    if (!isQiniuConfig(config)) return false;
    return !!(config.accessKey && config.secretKey && config.bucket && config.publicBaseUrl);
  }

  async uploadImage(bytes: Uint8Array, ext: string, config: ProviderConfig): Promise<string> {
    const cfg = config as QiniuProviderConfig;
    const hash = await sha1Hex(bytes);
    const key = joinKey(cfg.imageKeyPrefix || 'images/', `${hash}.${ext}`);
    const contentType = contentTypeForExt(ext);
    await postForm(cfg, key, bytes, contentType);
    return publicUrl(cfg, key);
  }

  async uploadHtml(html: string, config: ProviderConfig): Promise<string> {
    const cfg = config as QiniuProviderConfig;
    const bytes = new TextEncoder().encode(html);
    const hash = await sha1Hex(bytes);
    const key = joinKey(cfg.htmlKeyPrefix || 'html/', `${hash}.html`);
    await postForm(cfg, key, bytes, 'text/html; charset=utf-8');
    return publicUrl(cfg, key);
  }
}
