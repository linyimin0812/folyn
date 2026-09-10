/**
 * Upload retry helper — shared by R2 / OSS / Qiniu PUT/POST calls.
 *
 * Cloudflare R2, Aliyun OSS and 七牛云 each rate-limit (429 Too Many
 * Requests) and occasionally 5xx under load. Vault export now uploads in
 * parallel (bounded) and per-doc image uploads fan out further, so a burst
 * of PUTs can trip the limiter. `withUploadRetry` retries the fetch on a
 * retryable status (429 / 5xx) with exponential backoff + jitter, and
 * re-reads the body on each attempt (a `Response` body can only be consumed
 * once, so the caller re-runs the whole producer instead of replaying a
 * consumed stream).
 *
 * ponytail: no per-provider config (max attempts / base delay are fixed —
 * tune here if a provider needs it). Retry is bounded so a genuinely failing
 * upload still surfaces after ~a few seconds, not forever.
 */

/** Statuses worth retrying — throttling + transient server errors. */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

const MAX_ATTEMPTS = 4;
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 8000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Run `fn` (a fresh fetch producer); retry on a retryable HTTP status or a
 * network/abort failure, with exponential backoff + jitter. `fn` must be
 * re-callable — it produces a fresh Request each attempt (bodies aren't
 * replayable). Throws the last error if all attempts fail.
 */
export async function withUploadRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fn();
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt >= MAX_ATTEMPTS) break;
      const retryable = isRetryableError(err);
      if (!retryable) break;
      // Exponential backoff with full jitter: [0, base*2^(attempt-1)].
      const cap = Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS);
      const delay = Math.floor(Math.random() * cap);
      await sleep(delay);
    }
  }
  throw lastErr;
}

/** Is `err` worth retrying? Retryable HTTP status (429/5xx) or a network
 *  failure (TypeError from fetch — DNS/CORS/connection). */
function isRetryableError(err: unknown): boolean {
  // Network-level fetch failure (TypeError) — transient, worth a retry.
  if (err instanceof TypeError) return true;
  if (!(err instanceof Error)) return false;
  const msg = err.message;
  // Provider upload errors surface as "R2 upload failed: 429 …" etc.
  const m = msg.match(/\bupload failed: (\d{3})\b/);
  if (m && isRetryableStatus(Number(m[1]))) return true;
  return false;
}
