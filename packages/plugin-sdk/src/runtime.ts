/**
 * Runtime primitives shared by the Extension host and registries.
 *
 * Framework-agnostic, Tauri-free, no app deps — publishable from the SDK.
 */

import type { Disposable } from './Disposable';

/**
 * Append-only store of disposables. `dispose()` reaps every entry in reverse
 * insertion order (LIFO) so listeners/registries created last are torn down
 * first — mirroring the activation stack. A disposal error in one entry does
 * not stop the rest (each is try/caught + logged). Safe to call once; a second
 * `dispose()` is a no-op.
 */
export class DisposableStore {
  private readonly items: Disposable[] = [];
  private disposed = false;

  add<T extends Disposable>(d: T): T {
    if (this.disposed) {
      // Late add after disposal: reap immediately so the resource is not leaked.
      void Promise.resolve(d.dispose()).catch((err) => {
        console.error('[DisposableStore] late-add dispose failed:', err);
      });
      return d;
    }
    this.items.push(d);
    return d;
  }

  /** Reap every disposable in reverse insertion order. Idempotent. */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    const pending = this.items.splice(0);
    for (let i = pending.length - 1; i >= 0; i--) {
      try {
        await pending[i].dispose();
      } catch (err) {
        console.error('[DisposableStore] dispose failed:', err);
      }
    }
  }

  /** True once disposed. */
  get isDisposed(): boolean {
    return this.disposed;
  }
}

/**
 * Combine multiple AbortSignals (and undefineds) into one. The combined signal
 * aborts as soon as ANY input aborts. Used to propagate the runtime lifecycle
 * signal into per-call user signals (doc §6 AbortSignal 传播机制).
 */
export function combineSignals(
  ...signals: (AbortSignal | undefined)[]
): AbortSignal {
  const controller = new AbortController();
  for (const signal of signals) {
    if (!signal) continue;
    if (signal.aborted) {
      controller.abort();
      break;
    }
    signal.addEventListener(
      'abort',
      () => controller.abort(),
      { once: true },
    );
  }
  return controller.signal;
}
