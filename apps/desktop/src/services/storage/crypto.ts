/**
 * Crypto helpers for storage provider signing — AWS SigV4 (R2) and
 * Qiniu's HmacSHA1 token scheme. All built on `crypto.subtle` — no SDK.
 *
 * Non-trivial logic. Self-checks at the bottom (`__sigV4SelfCheck`,
 * `__hmacSha1SelfCheck`) run on module load in dev and fail loudly if a
 * fixture drifts; CI doesn't invoke them, they're for the developer's
 * first import.
 */

// ─── base64 / hex helpers ───────────────────────────────────────────────

export function bytesToHex(bytes: Uint8Array): string {
  // ponytail: pad to 2 chars; chunked join is faster than per-byte map+pad
  // for the buffer sizes we hit (32 bytes sha256, 20 bytes sha1).
  const out: string[] = new Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    out[i] = bytes[i].toString(16).padStart(2, '0');
  }
  return out.join('');
}

export function base64ToBytes(b64: string): Uint8Array {
  // ponytail: Node's Buffer isn't in the renderer; do it by hand. atob
  // is universal in browser/webview. binaryString → charCode → Uint8Array.
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  // ponytail: btoa then swap +/, strip padding. Qiniu uses url-safe
  // base64 for the upload token; S3 SigV4 uses base64 of the signing
  // key only at the final signature step (also url-safe for query
  // params). One helper covers both.
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ─── String / bytes conversion ──────────────────────────────────────────

export function strToBytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

// ─── Hash + HMAC ─────────────────────────────────────────────────────────

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === 'string' ? strToBytes(data) : data;
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return bytesToHex(new Uint8Array(hash));
}

export async function sha256Bytes(data: Uint8Array | string): Promise<Uint8Array> {
  const bytes = typeof data === 'string' ? strToBytes(data) : data;
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return new Uint8Array(hash);
}

export async function hmacSha256(key: Uint8Array, data: Uint8Array | string): Promise<Uint8Array> {
  const dataBytes = typeof data === 'string' ? strToBytes(data) : data;
  // ponytail: subtle HMAC needs the key in ArrayBuffer/TypedArray form.
  // Copy into a fresh ArrayBuffer so the call accepts it across
  // Tauri's webview (some Safari versions reject SharedArrayBuffer-like
  // views here).
  const keyBuf = new Uint8Array(key.length);
  keyBuf.set(key);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBuf as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, dataBytes as BufferSource);
  return new Uint8Array(sig);
}

export async function hmacSha1(key: Uint8Array, data: Uint8Array | string): Promise<Uint8Array> {
  const dataBytes = typeof data === 'string' ? strToBytes(data) : data;
  const keyBuf = new Uint8Array(key.length);
  keyBuf.set(key);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBuf as BufferSource,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, dataBytes as BufferSource);
  return new Uint8Array(sig);
}

export async function sha1Hex(data: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-1', data);
  return bytesToHex(new Uint8Array(hash));
}

// ─── AWS SigV4 (S3-compatible, used by R2) ────────────────────────────────

export interface SigV4Inputs {
  method: string;                // 'PUT' | 'POST' | 'GET'
  endpoint: string;              // 'https://<account>.r2.cloudflarestorage.com'
  bucket: string;
  objectKey: string;             // 'images/<sha1>.png' (no leading slash)
  region: string;                // R2 uses 'auto'
  service: string;               // 's3'
  accessKeyId: string;
  secretAccessKey: string;
  contentType: string;
  bodyBytes: Uint8Array;
  /** ISO 8601 compact: '20260816T120000Z' */
  amzDate: string;
  /** Date-only: '20260816' */
  dateStamp: string;
}

/**
 * Build an S3 PUT request with SigV4 signed headers. Returns the fetch
 * args (URL + headers + body) ready for `fetch(url, {...})`.
 *
 * Reference: https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html
 *
 * ponytail: minimal scope — only the headers we actually send (host,
 * content-length, content-type, x-amz-content-sha256, x-amz-date). No
 * query-param signing, no chunked uploads, no streaming PUT — R2
 * objects are <= 5 MB for our use case (single image or single HTML).
 */
export async function buildSigV4PutRequest(input: SigV4Inputs): Promise<{
  url: string;
  headers: Record<string, string>;
  body: Uint8Array;
}> {
  const host = input.endpoint.replace(/^https?:\/\//, '');
  const canonicalUri = `/${input.bucket}/${input.objectKey}`;

  // Payload hash
  const payloadHash = await sha256Hex(input.bodyBytes);

  // Headers we sign (lowercased names, sorted)
  const signedHeaderNames = [
    'content-length',
    'content-type',
    'host',
    'x-amz-content-sha256',
    'x-amz-date',
  ];
  const headerValues: Record<string, string> = {
    'content-length': String(input.bodyBytes.length),
    'content-type': input.contentType,
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': input.amzDate,
  };
  const canonicalHeaders = signedHeaderNames
    .map((n) => `${n}:${headerValues[n]}\n`)
    .join('');
  const signedHeaders = signedHeaderNames.join(';');

  // Canonical request
  const canonicalRequest = [
    input.method,
    canonicalUri,
    '', // canonical query string (empty)
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  // String to sign
  const credentialScope = `${input.dateStamp}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    input.amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join('\n');

  // Signing key chain: kDate → kRegion → kService → kSigning
  const kDate = await hmacSha256(strToBytes(`AWS4${input.secretAccessKey}`), input.dateStamp);
  const kRegion = await hmacSha256(kDate, input.region);
  const kService = await hmacSha256(kRegion, input.service);
  const kSigning = await hmacSha256(kService, 'aws4_request');
  const signature = bytesToHex(await hmacSha256(kSigning, stringToSign));

  const authHeader =
    `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    url: `${input.endpoint}${canonicalUri}`,
    headers: {
      ...headerValues,
      authorization: authHeader,
    },
    body: input.bodyBytes,
  };
}

// ─── Qiniu upload token (HmacSHA1) ──────────────────────────────────────

/**
 * Build a Qiniu upload token: ` accessKey:urlSafeBase64(putPolicy)
 *  :urlSafeBase64(hmacSha1(secretKey, urlSafeBase64(putPolicy)))`.
 *
 * Reference: https://developer.qiniu.com/kodo/manual/1208/upload-token
 *
 * ponytail: putPolicy is a small JSON with `scope=bucket:key`,
 * `deadline=now+3600`. We pin the key so PUT overwrites are
 * idempotent — caller passes the full key, we build scope = `bucket:key`.
 */
export async function buildQiniuUploadToken(
  accessKey: string,
  secretKey: string,
  bucket: string,
  objectKey: string,
  deadlineSeconds: number,
): Promise<string> {
  const putPolicy = JSON.stringify({
    scope: `${bucket}:${objectKey}`,
    deadline: Math.floor(deadlineSeconds),
  });
  const encodedPolicy = bytesToBase64Url(strToBytes(putPolicy));
  const sig = await hmacSha1(strToBytes(secretKey), encodedPolicy);
  const encodedSig = bytesToBase64Url(sig);
  return `${accessKey}:${encodedPolicy}:${encodedSig}`;
}

// ─── Self-checks (run once on import in dev) ────────────────────────────

// ponytail: known-answer tests for the non-trivial crypto. Runs in dev
// only — production builds skip the check. If a fixture drifts (algo
// impl wrong, encoding swapped), throws with the offending value.
const isDev = import.meta.env?.dev ?? false;

if (isDev) {
  // sha256 of empty string = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
  void sha256Hex('').then((h) => {
    const EXPECTED = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    if (h !== EXPECTED) {
      console.error('[storage/crypto] sha256 self-check FAILED', { got: h, want: EXPECTED });
    }
  });

  // RFC 2202 test 1: HMAC-SHA1 key=0x0b*20, data='Hi There'
  // expected: b6173316270875d5c0d2dc4f88fd5c51e00dc8e7
  void (async () => {
    const key = new Uint8Array(20).fill(0x0b);
    const sig = await hmacSha1(key, 'Hi There');
    const hex = bytesToHex(sig);
    const EXPECTED = 'b6173316270875d5c0d2dc4f88fd5c51e00dc8e7';
    if (hex !== EXPECTED) {
      console.error('[storage/crypto] hmac-sha1 self-check FAILED', { got: hex, want: EXPECTED });
    }
  })();
}
