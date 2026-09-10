/**
 * Host environment (theme + locale) capability for trusted-tier extensions.
 *
 * Mirrors the `buildExtensionAi` pattern: reads current state from the host's
 * `appearanceStore` + `localeStore`, exposes a `ExtensionEnv` surface, and
 * subscribes to store changes to fan out to extension-registered callbacks.
 * Extensions bring their own i18n bundles — only the locale identifier is
 * surfaced; host's `t()` is NOT exposed.
 *
 * ponytail: no new subscription path. Both stores are zustand; the raw
 * `subscribe(listener)` API fires on any state change and lets us diff
 * the relevant slice.
 */

import type { ExtensionEnv, ExtensionTheme } from '@folyn/extension-host';
import { disposable } from '@folyn/extension-host';
import { useAppearanceStore, type Theme } from '@/store/appearanceStore';
import { useLocaleStore } from '@/store/localeStore';

/** Resolve 'system' → 'light'|'dark' via the OS media query. MatchMedia is
 * available in the main webview and in trusted-extension blob-URL contexts
 * (same realm). */
function resolveSystemTheme(theme: Theme): ExtensionTheme {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return theme;
}

/** Per-env teardown carried in a WeakMap so the `ExtensionEnv` surface stays
 * plain (no internal methods leak). Keyed by env identity; drops when the
 * env is GC'd. */
const extensionEnvTeardowns = new WeakMap<ExtensionEnv, () => void>();

export function buildExtensionEnv(): ExtensionEnv {
  const themeCbs = new Set<(t: ExtensionTheme) => void>();
  const localeCbs = new Set<(l: string) => void>();

  const unsubscribeTheme = useAppearanceStore.subscribe((state, prev) => {
    if (state.theme === prev.theme) return;
    const resolved = resolveSystemTheme(state.theme);
    for (const cb of themeCbs) cb(resolved);
  });
  const unsubscribeLocale = useLocaleStore.subscribe((state, prev) => {
    if (state.locale === prev.locale) return;
    for (const cb of localeCbs) cb(state.locale);
  });

  const env: ExtensionEnv = {
    get theme(): ExtensionTheme {
      return resolveSystemTheme(useAppearanceStore.getState().theme);
    },
    get locale(): string {
      return useLocaleStore.getState().locale;
    },
    onThemeChange(cb: (t: ExtensionTheme) => void) {
      themeCbs.add(cb);
      return disposable(() => {
        themeCbs.delete(cb);
      });
    },
    onLocaleChange(cb: (l: string) => void) {
      localeCbs.add(cb);
      return disposable(() => {
        localeCbs.delete(cb);
      });
    },
  };

  extensionEnvTeardowns.set(env, () => {
    unsubscribeTheme();
    unsubscribeLocale();
    themeCbs.clear();
    localeCbs.clear();
  });
  return env;
}

/**
 * Tear down the host-side store subscriptions owned by a `ExtensionEnv` produced
 * by `buildExtensionEnv`. The trusted loader calls this on extension deactivate so
 * the store listeners (held in the env closure) are released. Extension-owned
 * `on*Change` disposables are reaped separately via `ctx.addDisposable`.
 */
export function disposeExtensionEnv(env: ExtensionEnv): void {
  const teardown = extensionEnvTeardowns.get(env);
  if (teardown) {
    extensionEnvTeardowns.delete(env);
    teardown();
  }
}
