/**
 * Query module: run jq or JSONPath expressions against a parsed JS value.
 *
 * Both engines are lazy-loaded:
 *   - jq-wasm  (~2 MB WASM) — loaded inside a Web Worker (`./jq.worker.ts`)
 *     so the UI thread never blocks. The worker is constructed on first
 *     `runJq` call. If `Worker` is unavailable (e.g. vitest jsdom without
 *     worker support), falls back to a direct dynamic import of the worker
 *     module's `executeJq` so the function still works.
 *   - jsonpath-plus (~50 KB) — small enough to lazy-import on the main
 *     thread. Uses the browser ESM build (declared in the package's
 *     `exports.browser` field).
 *
 * Both functions return `Promise<unknown>` and throw `Error` with a
 * descriptive message on invalid input/expression.
 */

let worker: Worker | null = null;
let nextRequestId = 1;
const pendingRequests = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (err: Error) => void }
>();

function getWorker(): Worker | null {
  if (worker) return worker;
  if (typeof Worker === 'undefined') return null;
  try {
    worker = new Worker(new URL('./jq.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (e: MessageEvent) => {
      const data = e.data as
        | { id: number; ok: true; result: unknown }
        | { id: number; ok: false; error: string }
        | null
        | undefined;
      if (!data || typeof data.id !== 'number') return;
      const pending = pendingRequests.get(data.id);
      if (!pending) return;
      pendingRequests.delete(data.id);
      if (data.ok) {
        pending.resolve(data.result);
      } else {
        pending.reject(new Error(data.error));
      }
    };
    worker.onerror = (err) => {
      // Reject all pending requests; the worker is in an unknown state.
      const message = err.message ?? 'jq worker error';
      for (const [id, pending] of pendingRequests) {
        pendingRequests.delete(id);
        pending.reject(new Error(message));
      }
    };
    return worker;
  } catch {
    return null;
  }
}

/**
 * Run a jq expression against `input` (a parsed JS value or JSON string).
 * Uses the jq-wasm worker; falls back to direct `executeJq` if no Worker.
 */
export async function runJq(input: unknown, expr: string): Promise<unknown> {
  if (typeof expr !== 'string' || expr.length === 0) {
    throw new Error('jq: empty expression');
  }
  const w = getWorker();
  if (w === null) {
    // Test/fallback path: dynamic-import the worker module directly so the
    // `jq-wasm` chunk still loads on demand (no static import into the main
    // bundle).
    const { executeJq } = await import('./jq.worker');
    return executeJq(input, expr);
  }
  const id = nextRequestId++;
  return new Promise<unknown>((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject });
    w.postMessage({ id, input, expr } satisfies { id: number; input: unknown; expr: string });
  });
}

/**
 * Run a JSONPath expression against `input` (a parsed JS value).
 * Uses `jsonpath-plus`'s browser ESM build via dynamic import.
 */
export async function runJsonPath(input: unknown, expr: string): Promise<unknown> {
  if (typeof expr !== 'string' || expr.length === 0) {
    throw new Error('jsonpath: empty expression');
  }
  const mod = await import('jsonpath-plus');
  const JSONPath = mod.JSONPath;
  if (typeof JSONPath !== 'function') {
    throw new Error('jsonpath-plus: JSONPath is not available');
  }
  // jsonpath-plus throws on malformed expressions; wrap to normalize.
  try {
    const result = JSONPath({ path: expr, json: input as object });
    return result as unknown;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`jsonpath: ${msg}`);
  }
}

export type QueryLang = 'jq' | 'jsonpath';

/**
 * Dispatch to the selected query engine. Returns the raw match result.
 */
export async function runQuery(
  lang: QueryLang,
  input: unknown,
  expr: string,
): Promise<unknown> {
  if (lang === 'jq') return runJq(input, expr);
  return runJsonPath(input, expr);
}
