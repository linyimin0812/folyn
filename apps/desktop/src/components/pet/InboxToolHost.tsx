/**
 * InboxToolHost — realm wiring for the built-in inbox popup
 * (PRD 09-19-inbox-command-popup).
 *
 * Mounted by ExtensionToolApp inside the `extension-tool-panel` window when
 * the tool payload is `builtin:inbox` (opened by the `action.open-inbox`
 * command). The popup reuses the full extension-tool window machinery
 * (drag / pin / maximize / close / Esc / blur auto-hide — all owned by
 * ExtensionToolApp's shared chrome) and renders React content (the
 * `PetInbox` list, previously the pet panel's Inbox tab) instead of the
 * sandboxed extension iframe. Same pattern as TranslationToolHost, minus
 * everything the inbox doesn't need: no inputs (auto-capitalize), no
 * markdown links (external-link interceptor), no model providers.
 *
 * The window is a separate JS realm, so the store instance here starts
 * empty and must be mirrored from the main window:
 *  - `useTheme` — syncs data-theme to this realm's DOM;
 *  - settings hydration — `pet://settings-updated` listen →
 *    `hydrateAllStores` + `markSettingsHydrated`, plus a
 *    `pet://settings-request` emit on mount (the main window's
 *    usePetHostBridge answers with the current blob). The petStore slice
 *    (`inboxItems`) hydrates from it; new notifications captured by the
 *    main window's petNotifyDispatcher reach the open popup through the
 *    same broadcast. After `markSettingsHydrated`, this popup's own
 *    setters (clear / remove) persist DIRECTLY: persist() →
 *    storageClient.set → debounced writeTextFile to
 *    ~/.folyn/storage/pet.json, permitted by the narrowly-scoped fs grant
 *    in capabilities/extension-tool.json ($HOME/.folyn/storage only; no
 *    read). The same persist also broadcasts `pet://settings-updated`,
 *    keeping the main window's store in sync so its next broadcast doesn't
 *    resurrect cleared rows (the TranslationToolHost v3 rationale);
 *  - locale sync — `locale://changed` → `i18n.changeLanguage` +
 *    `useLocaleStore.setState` on this realm's own instances.
 */

import { useEffect } from 'react';
import { isTauri } from '@/utils/platform';
import { hydrateAllStores, markSettingsHydrated } from '@/store/settingsPersistence';
import { useTheme } from '@/hooks/useTheme';
import { PetInbox } from './PetInbox';
import type { Locale } from '@/i18n';

export function InboxToolHost() {
  // Theme sync (data-theme + code-highlight CSS) for this realm's DOM —
  // without it the popup renders in whatever data-theme the shared CSS
  // defaulted to, not the user's setting.
  useTheme();

  // ── Cross-window settings hydration ──
  // The popup holds its own petStore instance (separate JS realm); without
  // this listener it would never see writes from the main window (e.g.
  // `addInboxItem` on `pet://notify`), because those only update the main
  // window's store and broadcast via `pet://settings-updated`. Mirrors the
  // pet-panel / TranslationToolHost listeners — same channel, same
  // `hydrateAllStores` call. The startup broadcast fires before this
  // webview registers its listener, so emit `pet://settings-request` after
  // registering — the main window answers with the current merged blob.
  // Secondary windows hydrate from the broadcast (NOT loadSettings —
  // re-reading the storage files directly would race the main window's
  // writes). See the header comment for why markSettingsHydrated matters
  // here (the popup's clear/remove must persist + broadcast, not just
  // mutate this realm).
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        const { listen, emit } = await import('@tauri-apps/api/event');
        const un = await listen<Record<string, unknown>>(
          'pet://settings-updated',
          (event) => {
            if (!event.payload) return;
            hydrateAllStores(event.payload);
            markSettingsHydrated();
          },
        );
        if (disposed) un();
        else unlisten = un;
        // Request the current snapshot (the startup broadcast was missed) —
        // skip it if the host already unmounted (the tool payload can
        // switch to a third-party tool, unmounting this host).
        if (!disposed) await emit('pet://settings-request', {});
      } catch (err) {
        console.warn('[inbox-tool] settings-updated listener failed:', err);
      }
    })();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // ── Cross-window locale change sync ──
  // The main window's `localeStore.setLocale` emits `locale://changed` so
  // each secondary Tauri window (separate JS realm with its own i18next +
  // localeStore instance) can apply the new locale without a reload. The
  // inbox's labels (empty state, kind tags, Clear) are locale-driven, so
  // without this listener it would stay in the language loaded at launch.
  // Mirrors the `locale://changed` listener in PetPanelApp.
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        const i18n = (await import('@/i18n')).default;
        const { useLocaleStore } = await import('@/store/localeStore');
        const un = await listen<{ locale: Locale }>(
          'locale://changed',
          (event) => {
            const lg = event.payload?.locale;
            if (!lg) return;
            void i18n.changeLanguage(lg);
            useLocaleStore.setState({ locale: lg });
          },
        );
        if (disposed) un();
        else unlisten = un;
      } catch (err) {
        console.warn('[inbox-tool] locale-changed listener setup failed:', err);
      }
    })();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  return <PetInbox />;
}
