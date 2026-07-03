/**
 * jq.worker — Vite Web Worker entry that runs jq-wasm off the main thread.
 *
 * jq-wasm loads a ~2 MB WASM blob via `fetch(new URL('./build/jq.wasm',
 * import.meta.url))`. Keeping that load + every jq invocation inside a worker
 * means the UI thread never blocks, even on large queries.
 *
 * The module also exports `executeJq` so unit tests can exercise the jq
 * invocation logic without spinning up a real Worker (vitest's jsdom env
 * doesn't reliably support `new Worker(new URL(..., import.meta.url))`).
 * Tests mock `jq-wasm` and call `executeJq` directly.
 *
 * Message protocol (request → response):
 *   request:  { id: number, input: unknown, expr: string }
 *   response: { id: number, ok: true, result: unknown }
 *             | { id: number, ok: false, error: string }
 */
import { json as jqJson } from 'jq-wasm';

export interface JqWorkerRequest {
  id: number;
  input: unknown;
  expr: string;
}

export type JqWorkerResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string };

/**
 * Run a jq expression against `input`. Exported for unit tests; the worker
 * `onmessage` handler is the production entry point.
 *
 * jq-wasm's `json()` accepts `string | object` and returns `object | object[]
 * | null`. We widen to `unknown` for the query module's uniform return type
 * (JSONPath returns `unknown` too).
 */
export async function executeJq(input: unknown, expr: string): Promise<unknown> {
  if (typeof expr !== 'string' || expr.length === 0) {
    throw new Error('jq: empty expression');
  }
  // jq-wasm accepts either a string (parsed as JSON by jq itself) or a
  // pre-parsed object. Passing the parsed value directly avoids a
  // serialize/parse round-trip and matches the JSONPath path.
  const inputArg = (typeof input === 'string' ? input : input) as string | object;
  const result = await jqJson(inputArg, expr);
  return result as unknown;
}

function postResponse(res: JqWorkerResponse): void {
  // `self` in a Vite Web Worker is the DedicatedWorkerGlobalScope. Cast
  // loosely (TS lib may not include worker typings when tsconfig "lib"
  // doesn't include "WebWorker"); the runtime method exists.
  (self as unknown as { postMessage: (m: JqWorkerResponse) => void }).postMessage(res);
}

const workerCtx = self as unknown as {
  onmessage: ((e: MessageEvent<JqWorkerRequest>) => void) | null;
};
workerCtx.onmessage = async (e: MessageEvent<JqWorkerRequest>) => {
  const { id, input, expr } = e.data ?? ({} as JqWorkerRequest);
  if (typeof id !== 'number') return;
  try {
    const result = await executeJq(input, expr);
    postResponse({ id, ok: true, result });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    postResponse({ id, ok: false, error });
  }
};
