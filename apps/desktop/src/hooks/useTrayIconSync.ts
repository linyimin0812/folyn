// useTrayIconSync — syncs the Rust-side tray icon with the persisted
// `showTrayIcon` flag. Extracted from App.tsx (split-oversized-p1-files).
//
// Spec: hook-guidelines.md (effect cleanup).

import { useEffect } from 'react';
import { useAppearanceStore } from '@/store/appearanceStore';
import { isTauri } from '@/utils/platform';

export function useTrayIconSync() {
  // ── Tray icon: sync Rust-side with the persisted `showTrayIcon` flag ──
  // Mirrors the voice-hotkey subscribe pattern: `loadSettings()` is
  // fire-and-forget async, so reading `showTrayIcon` at mount time returns
  // the default `false` before hydration lands. Initial invoke + subscribe
  // covers both the cache-hit case and the post-hydrate `false` → `true`
  // transition. The SettingsPage Toggle also invokes on change, but this
  // effect is the source of truth for startup + external hydrate paths.
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    let unsub: (() => void) | undefined;
    const sync = async (enabled: boolean) => {
      if (cancelled) return;
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const i18n = (await import('@/i18n')).default;
        await invoke('tray_set_enabled', { enabled, locale: i18n.language || 'en' });
      } catch (err) {
        console.warn('[tray] sync failed:', err);
      }
    };
    void sync(useAppearanceStore.getState().showTrayIcon);
    unsub = useAppearanceStore.subscribe((state, prev) => {
      if (state.showTrayIcon !== prev.showTrayIcon) {
        void sync(state.showTrayIcon);
      }
    });
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, []);
}
