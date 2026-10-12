/**
 * Normalize any rejection value into a human-readable message.
 *
 * Why: `runRigChat` (and every Tauri invoke whose Rust command returns
 * `Result<_, AppError>`) rejects with a PLAIN OBJECT — the serialized
 * `AppError` `{category, detail}` (see src-tauri/src/errors.rs and
 * tauriInvoke.ts). `String(err)` on it yields "[object Object]" and hides
 * the real cause, which is exactly how the AI-note banner ended up showing
 * `[object Object]`. Handles Error / string / `{message}` / `{detail}` /
 * `{error}` (string or nested `{message}`) / `{status|code|category}`;
 * the code-ish field is prefixed when present (e.g. `401: <message>`).
 * Unexpected object shapes fall back to JSON so their fields stay visible.
 */
export function errorToMessage(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message || err.name;
  if (typeof err === 'object' && err !== null) {
    const obj = err as Record<string, unknown>;
    let msg = '';
    for (const key of ['detail', 'message', 'error']) {
      const v = obj[key];
      if (typeof v === 'string' && v.trim()) {
        msg = v;
        break;
      }
      const nested =
        v && typeof v === 'object' ? (v as Record<string, unknown>).message : undefined;
      if (typeof nested === 'string' && nested.trim()) {
        msg = nested;
        break;
      }
    }
    if (!msg) {
      // Last resort: show the fields rather than collapsing to "[object Object]".
      try {
        msg = JSON.stringify(err);
      } catch {
        msg = '';
      }
    }
    const code = obj.status ?? obj.code ?? obj.category;
    const codeStr =
      typeof code === 'number' || (typeof code === 'string' && code.trim()) ? String(code) : '';
    if (codeStr) return `${codeStr}: ${msg}`;
    return msg || 'unknown error';
  }
  return String(err);
}
