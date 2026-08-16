/**
 * Aliyun OSS storage provider (V4 signing, HMAC-SHA256).
 *
 * Endpoint: https://<bucket>.<region>.aliyuncs.com (virtual-hosted-style)
 * Region: bare form like `cn-hangzhou` in scope; endpoint hostname prepends `oss-`.
 *
 * Reference: aliyun-oss-python-sdk `oss2/auth.py` `ProviderAuthV4`.
 */
import type { ProviderConfig, OssProviderConfig, StorageProvider } from '../types';
import { buildOssV4PutRequest, sha1Hex } from '../crypto';
import { isOssConfig } from '../types';

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
  const res = await fetch(req.url, {
    method: 'PUT',
    headers: req.headers,
    body: req.body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const trimmed = text.length > 200 ? text.slice(0, 200) + '…' : text;
    throw new Error(`OSS upload failed: ${res.status} ${res.statusText} ${trimmed}`);
  }
}

export class OssProvider implements StorageProvider {
  readonly id = 'oss';
  readonly labelKey = 'settings:storage.provider.oss.label';
  readonly icon = '🟧';
  readonly capabilities = { image: true, html: true };

  isConfigured(config: ProviderConfig | null): config is OssProviderConfig {
    if (!isOssConfig(config)) return false;
    return !!(config.accessKeyId && config.accessKeySecret && config.bucket && config.region && config.publicBaseUrl);
  }

  async uploadImage(bytes: Uint8Array, ext: string, config: ProviderConfig): Promise<string> {
    const cfg = config as OssProviderConfig;
    const hash = await sha1Hex(bytes);
    const key = joinKey(cfg.imageKeyPrefix || 'images/', `${hash}.${ext}`);
    const contentType = ext === 'png' ? 'image/png'
      : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
      : ext === 'webp' ? 'image/webp'
      : ext === 'gif' ? 'image/gif'
      : ext === 'svg' ? 'image/svg+xml'
      : 'application/octet-stream';
    await putObject(cfg, key, bytes, contentType);
    return publicUrl(cfg, key);
  }

  async uploadHtml(html: string, config: ProviderConfig): Promise<string> {
    const cfg = config as OssProviderConfig;
    const bytes = new TextEncoder().encode(html);
    const hash = await sha1Hex(bytes);
    const key = joinKey(cfg.htmlKeyPrefix || 'html/', `${hash}.html`);
    await putObject(cfg, key, bytes, 'text/html; charset=utf-8');
    return publicUrl(cfg, key);
  }
}
