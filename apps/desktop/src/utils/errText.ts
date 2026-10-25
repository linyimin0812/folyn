/**
 * Coerce any thrown/rejected value into a readable message string.
 *
 * Tauri invoke / plugin-fs rejections are often plain objects
 * (`{ message }` / `{ error }`), which `String(err)` renders as
 * `[object Object]`.
 */
export function errText(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (typeof err === 'object' && err !== null) {
    const rec = err as Record<string, unknown>;
    if (typeof rec.message === 'string') return rec.message;
    if (typeof rec.error === 'string') return rec.error;
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}
