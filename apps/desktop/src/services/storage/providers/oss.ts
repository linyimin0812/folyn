/**
 * Aliyun OSS storage provider (V4 signing, HMAC-SHA256).
 *
 * Endpoint: https://<bucket>.<region>.aliyuncs.com (virtual-hosted-style)
 * Region: bare form like `cn-hangzhou` in scope; endpoint hostname prepends `oss-`.
 *
 * Reference: aliyun-oss-python-sdk `oss2/auth.py` `ProviderAuthV4`.
 */
import type { OssProviderConfig, StorageProviderCapabilities } from '../types';
import { buildOssV4PutRequest, sha1Hex } from '../crypto';
import { contentTypeForExt } from '../contentType';
import { withUploadRetry } from '../retry';

function nowOssDate(): { amzDate: string; dateStamp: string } {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const dateStamp = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
  const amzDate = `${dateStamp}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
  return { amzDate, dateStamp };
}

/** Normalize region: strip a leading `oss-` so both forms work. Stored form
 *  is bare; the endpoint hostname always re-prepends `oss-`. */
function normalizeRegion(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.startsWith('oss-') ? trimmed.slice(4) : trimmed;
}

function joinKey(prefix: string, key: string): string {
  const p = prefix.replace(/^\/+|\/+$/g, '');
  const k = key.replace(/^\/+/, '');
  return p ? `${p}/${k}` : k;
}

function publicUrl(cfg: OssProviderConfig, objectKey: string): string {
  const base = cfg.publicBaseUrl.replace(/\/+$/, '');
  return `${base}/${objectKey}`;
}

/** Endpoint hostname uses the `oss-` prefix; scope region uses the bare form. */
function endpoint(cfg: OssProviderConfig): string {
  const bare = normalizeRegion(cfg.region);
  return `https://${cfg.bucket}.oss-${bare}.aliyuncs.com`;
}

async function putObject(
  cfg: OssProviderConfig,
  objectKey: string,
  body: Uint8Array,
  contentType: string,
): Promise<void> {
  // Retry on throttling (429) / 5xx with exponential backoff; the signed
  // request is rebuilt each attempt.
  await withUploadRetry(async () => {
    const { amzDate, dateStamp } = nowOssDate();
    const req = await buildOssV4PutRequest({
      method: 'PUT',
      endpoint: endpoint(cfg),
      bucket: cfg.bucket,
      objectKey,
      region: normalizeRegion(cfg.region),
      accessKeyId: cfg.accessKeyId,
      accessKeySecret: cfg.accessKeySecret,
      contentType,
      bodyBytes: body,
      amzDate,
      dateStamp,
    });
    const res = await fetch(req.url, { method: 'PUT', headers: req.headers, body: req.body as BodyInit });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const trimmed = text.length > 200 ? text.slice(0, 200) + '…' : text;
      throw new Error(`OSS upload failed: ${res.status} ${res.statusText} ${trimmed}`);
    }
  });
}

export class OssProvider {
  readonly id = 'oss';
  readonly labelKey = 'settings:storage.provider.oss.label';
  readonly icon = 'aliyun';
  readonly capabilities: StorageProviderCapabilities = { image: true, html: true };

  isConfigured(config: unknown): config is OssProviderConfig {
    if (!config || (config as OssProviderConfig).provider !== 'oss') return false;
    const c = config as OssProviderConfig;
    return !!(c.accessKeyId && c.accessKeySecret && c.bucket && c.region && c.publicBaseUrl);
  }

  async uploadImage(bytes: Uint8Array, ext: string, config: unknown): Promise<string> {
    const cfg = config as OssProviderConfig;
    const hash = await sha1Hex(bytes);
    const key = joinKey(cfg.imageKeyPrefix || 'images/', `${hash}.${ext}`);
    const contentType = contentTypeForExt(ext);
    await putObject(cfg, key, bytes, contentType);
    return publicUrl(cfg, key);
  }

  async uploadHtml(html: string, config: unknown): Promise<string> {
    const cfg = config as OssProviderConfig;
    const bytes = new TextEncoder().encode(html);
    const hash = await sha1Hex(bytes);
    const key = joinKey(cfg.htmlKeyPrefix || 'html/', `${hash}.html`);
    await putObject(cfg, key, bytes, 'text/html; charset=utf-8');
    return publicUrl(cfg, key);
  }
}
