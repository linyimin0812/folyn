/**
 * GitHub Contents API upload + jsDelivr public URL.
 *
 * Upload: PUT https://api.github.com/repos/<owner>/<repo>/contents/<key>
 * Body: { message, content: <base64>, branch }
 * Auth: Bearer <PAT> (classic PAT with `repo` scope, or fine-grained with
 *       Contents: write on the repo).
 *
 * Public URL (jsDelivr): https://cdn.jsdelivr.net/gh/<owner>/<repo>@<branch>/<key>
 *
 * Idempotent: a re-upload of the same image bytes yields the same hash → same
 * key → GitHub 422 "already_exists" → we return the URL anyway (unchanged).
 */
import type { GithubJsdelivrConfig } from './config';

export function isConfigured(config: unknown): boolean {
  if (!config) return false;
  const c = config as Partial<GithubJsdelivrConfig>;
  return !!(c.owner && c.repo && c.branch && c.token);
}

function joinKey(prefix: string, key: string): string {
  const p = (prefix || 'images/').replace(/^\/+|\/+$/g, '');
  const k = key.replace(/^\/+/, '');
  return p ? `${p}/${k}` : k;
}

function publicUrl(cfg: GithubJsdelivrConfig, objectKey: string): string {
  return `https://cdn.jsdelivr.net/gh/${cfg.owner}/${cfg.repo}@${cfg.branch}/${objectKey}`;
}

/** bytes → base64 (GitHub Contents API wants base64 content). */
function toBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

async function sha1Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', bytes as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function uploadImage(
  bytes: Uint8Array,
  ext: string,
  config: unknown,
): Promise<string> {
  const cfg = config as GithubJsdelivrConfig;
  const hash = await sha1Hex(bytes);
  const key = joinKey(cfg.imageKeyPrefix ?? 'images/', `${hash}.${ext}`);

  const url = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: `chore(images): upload ${hash}.${ext}`,
      content: toBase64(bytes),
      branch: cfg.branch,
    }),
  });

  // 201 = created. 422 with "already_exists" = same-hash re-upload; the object
  // is already at the target path, so the jsDelivr URL is unchanged.
  if (res.status !== 201 && res.status !== 422) {
    const text = await res.text().catch(() => '');
    const trimmed = text.length > 200 ? text.slice(0, 200) + '…' : text;
    throw new Error(`GitHub upload failed: ${res.status} ${res.statusText} ${trimmed}`);
  }

  return publicUrl(cfg, key);
}
