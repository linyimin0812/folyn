/**
 * Disposable — the lifecycle primitive every extension contribution must return.
 *
 * The host stores every disposable a extension registers via `ExtensionContext.addDisposable`
 * and calls `dispose()` on deactivation / uninstall so listeners, registry entries,
 * React roots, and timers are cleaned up deterministically.
 */
export interface Disposable {
  dispose(): Promise<void> | void;
}

/** Wrap a plain callback as a Disposable. */
export function disposable(dispose: () => Promise<void> | void): Disposable {
  return { dispose };
}
