/**
 * Cloudflare R2 storage provider (S3-compatible API).
 *
 * Endpoint: https://<accountId>.r2.cloudflarestorage.com
 * Region: 'auto' (R2 ignores region but SigV4 needs one)
 *
 * Reference: https://developers.cloudflare.com/r2/api/s3/api/
 */
import type { ProviderConfig, R2ProviderConfig, StorageProvider } from '../types';
import { buildSigV4PutRequest, sha1Hex } from '../crypto';
import { isR2Config } from '../types';
import { contentTypeForExt } from '../contentType';

function nowAmzDate(): { amzDate: string; dateStamp: string } {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const dateStamp = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
  const amzDate = `${dateStamp}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
  return { amzDate, dateStamp };
}

function joinKey(prefix: string, key: string): string {
  const p = prefix.replace(/^\/+|\/+$/g, '');
  const k = key.replace(/^\/+/, '');
  return p ? `${p}/${k}` : k;
}

function publicUrl(cfg: R2ProviderConfig, objectKey: string): string {
  const base = cfg.publicBaseUrl.replace(/\/+$/, '');
  return `${base}/${objectKey}`;
}

async function putObject(
  cfg: R2ProviderConfig,
  objectKey: string,
  body: Uint8Array,
  contentType: string,
): Promise<void> {
  const endpoint = `https://${cfg.accountId}.r2.cloudflarestorage.com`;
  const { amzDate, dateStamp } = nowAmzDate();
  const req = await buildSigV4PutRequest({
    method: 'PUT',
    endpoint,
    bucket: cfg.bucket,
    objectKey,
    region: 'auto',
    service: 's3',
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    contentType,
    bodyBytes: body,
    amzDate,
    dateStamp,
  });
  const res = await fetch(req.url, {
    method: 'PUT',
    headers: req.headers,
    body: req.body,
  });
  if (!res.ok) {
    // ponytail: don't try to parse XML error body; surface status + key
    // so the user can see which object failed. R2 errors come back as
    // S3-style <Error><Code>…</Code><Message>…</Message></Error> — strip
    // tags is overkill for a toast.
    const text = await res.text().catch(() => '');
    const trimmed = text.length > 200 ? text.slice(0, 200) + '…' : text;
    throw new Error(`R2 upload failed: ${res.status} ${res.statusText} ${trimmed}`);
  }
}

export class R2Provider implements StorageProvider {
  readonly id = 'r2';
  readonly labelKey = 'settings:storage.provider.r2.label';
  readonly icon = '☁️';
  readonly capabilities = { image: true, html: true };

  isConfigured(config: ProviderConfig | null): config is R2ProviderConfig {
    if (!isR2Config(config)) return false;
    return !!(config.accountId && config.accessKeyId && config.secretAccessKey && config.bucket && config.publicBaseUrl);
  }

  async uploadImage(bytes: Uint8Array, ext: string, config: ProviderConfig): Promise<string> {
    const cfg = config as R2ProviderConfig;
    const hash = await sha1Hex(bytes);
    const key = joinKey(cfg.imageKeyPrefix || 'images/', `${hash}.${ext}`);
    const contentType = contentTypeForExt(ext);
    await putObject(cfg, key, bytes, contentType);
    return publicUrl(cfg, key);
  }

  async uploadHtml(html: string, config: ProviderConfig): Promise<string> {
    const cfg = config as R2ProviderConfig;
    const bytes = new TextEncoder().encode(html);
    const hash = await sha1Hex(bytes);
    const key = joinKey(cfg.htmlKeyPrefix || 'html/', `${hash}.html`);
    await putObject(cfg, key, bytes, 'text/html; charset=utf-8');
    return publicUrl(cfg, key);
  }
}
