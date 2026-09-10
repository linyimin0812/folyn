/**
 * ExtensionRuntime — one per activation (doc §35, §36, §59).
 *
 * Owns the AbortController, a DisposableStore, and the scoped
 * {@link ExtensionContext} (with `signal`). Activation is **transactional**:
 * disposables pushed during `activate()` are buffered, then committed on
 * success or rolled back (reverse order) on failure — so a extension that
 * activates half-way then throws leaves NO contributions behind (doc §59).
 *
 * `dispose()` = abort (cancel in-flight ops) → `deactivate()` hook → reap
 * disposables (LIFO).
 */

import { combineSignals, DisposableStore } from 'folyn-extension-sdk';
import type {
  Disposable,
  Extension,
  ExtensionApi,
  ExtensionContext,
  ExtensionLogger,
} from 'folyn-extension-sdk';

export interface ExtensionRuntimeOptions {
  readonly extension: Extension;
  readonly api: ExtensionApi;
  /** Base context the runtime layers `signal`/`addDisposable` onto. */
  readonly context: Omit<ExtensionContext, 'signal' | 'addDisposable'>;
}

export class ExtensionRuntime {
  private readonly abortController = new AbortController();
  private readonly disposables = new DisposableStore();
  private readonly staged: Disposable[] = [];
  private committed = false;
  private state: 'activating' | 'active' | 'deactivating' | 'disposed' = 'activating';

  /** The scoped context handed to the extension's activate/deactivate. */
  readonly context: ExtensionContext;

  constructor(private readonly options: ExtensionRuntimeOptions) {
    this.context = {
      ...options.context,
      signal: this.abortController.signal,
      addDisposable: (d: Disposable) => this.addDisposable(d),
    };
  }

  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  /** Push a disposable. During activation it is staged (transactional); after
   * commit it flows straight into the DisposableStore. */
  addDisposable(d: Disposable): void {
    if (this.disposables.isDisposed) return;
    if (!this.committed) {
      this.staged.push(d);
    } else {
      this.disposables.add(d);
    }
  }

  /** Activate the extension. Commits staged disposables on success, rolls back
   * on failure. Throws if activate throws (caller sets state='failed'). */
  async activate(): Promise<void> {
    try {
      await this.options.extension.activate(this.options.api, this.context);
      this.commit();
      this.state = 'active';
    } catch (err) {
      await this.rollback();
      this.state = 'disposed';
      throw err;
    }
  }

  /** Abort → deactivate hook → reap disposables. Idempotent. */
  async dispose(): Promise<void> {
    if (this.state === 'disposed') return;
    this.state = 'deactivating';
    // 1. Abort all in-flight operations using the runtime signal.
    this.abortController.abort();
    // 2. Extension cleanup hook (contributions still registered at this point).
    // ponytail: save the error, complete cleanup (dispose disposables),
    // then rethrow so the host can mark state='failed'. A deactivate throw
    // must not stop the LIFO disposable reap below.
    let deactivateError: unknown = undefined;
    try {
      await this.options.extension.deactivate?.(this.context);
    } catch (err) {
      deactivateError = err;
      console.error('[extension-runtime] deactivate threw:', err);
    }
    // 3. Reap every disposable (LIFO).
    await this.disposables.dispose();
    this.state = 'disposed';
    if (deactivateError !== undefined) throw deactivateError;
  }

  private commit(): void {
    if (this.committed) return;
    this.committed = true;
    for (const d of this.staged.splice(0)) {
      this.disposables.add(d);
    }
  }

  private async rollback(): Promise<void> {
    // Reverse so the last-registered is disposed first (mirrors activate stack).
    for (let i = this.staged.length - 1; i >= 0; i--) {
      try {
        await this.staged[i].dispose();
      } catch (err) {
        console.error('[extension-runtime] rollback dispose failed:', err);
      }
    }
    this.staged.length = 0;
    await this.disposables.dispose();
  }
}

/**
 * Logger used by default runtimes. Hosts may inject a richer one; this keeps
 * the runtime testable without a logging dependency.
 */
export const consoleLogger: ExtensionLogger = {
  debug: (msg, ...args) => console.debug(`[extension] ${msg}`, ...args),
  info: (msg, ...args) => console.info(`[extension] ${msg}`, ...args),
  warn: (msg, ...args) => console.warn(`[extension] ${msg}`, ...args),
  error: (msg, error) => console.error(`[extension] ${msg}`, error ?? ''),
};

export { combineSignals };
