/**
 * TranslationToolHost — realm wiring for the built-in translation popup
 * (PRD 09-18-translation-popup-refactor).
 *
 * Mounted by ExtensionToolApp inside the `extension-tool-panel` window when
 * the tool payload is `builtin:translation`: the popup reuses the full
 * extension-tool window machinery (drag / pin / maximize / close / Esc /
 * blur auto-hide — all owned by ExtensionToolApp's shared chrome) and
 * renders React content (the embedded `TranslationPanel`) instead of the
 * sandboxed extension iframe.
 *
 * The window is a separate JS realm (same as pet-panel), so every store
 * instance here starts empty and must be mirrored from the main window.
 * Each effect below is copied from PetPanelApp's proven wiring, adjusted
 * only for this popup:
 *  - `useDisableAutoCapitalize` — the main window's auto-capitalize
 *    observer never crosses realms, and the translation input needs it;
 *  - `installExternalLinkInterceptor` — same realm argument for external
 *    links in the markdown-rendered translation result;
 *  - `useTheme` — syncs data-theme / code-highlight CSS to this realm's DOM;
 *  - providers mirror — `pet://providers-updated` listen +
 *    `pet://providers-request` emit (the model selector + `extensionPair`
 *    need providerSettings + modelsByProvider from ~/.folyn/providers/);
 *  - settings hydration — `pet://settings-updated` listen →
 *    `hydrateAllStores` + `markSettingsHydrated`, plus a `pet://settings-request`
 *    emit on mount (the main window's usePetHostBridge answers with the current
 *    blob). The translationStore slice (source/target/input/result/prefs)
 *    hydrates from it. This popup's own setters persist DIRECTLY: persist() →
 *    storageClient.set → debounced writeTextFile to
 *    ~/.folyn/storage/translation.json, permitted by the narrowly-scoped fs
 *    grant in capabilities/extension-tool.json ($HOME/.folyn/storage only;
 *    exists/mkdir/write-text-file — no read). The same persist also fires the
 *    `pet://settings-updated` broadcast, which keeps the OTHER realms' stores
 *    (main window + pet windows) in sync, so the main window's quit-time
 *    persistNow() flush and any concurrent main-window edits stay coherent.
 *    (v3: the previous broadcast-only design relied on the main window's
 *    quit-flush as the sole disk writer — which loses this popup's config on
 *    any non-graceful exit: dev reload / Ctrl-C / crash — the reported
 *    “translation prefs reset on restart” bug);
 *  - locale sync — `locale://changed` → `i18n.changeLanguage` +
 *    `useLocaleStore.setState` on this realm's own instances.
 */

import { useEffect } from 'react';
import { isTauri } from '@/utils/platform';
import { hydrateAllStores, markSettingsHydrated } from '@/store/settingsPersistence';
import { useAiConfigStore } from '@/store/aiConfigStore';
import { useModelRegistryStore } from '@/store/modelRegistryStore';
import { useDisableAutoCapitalize } from '@/hooks/useDisableAutoCapitalize';
import { installExternalLinkInterceptor } from '@/services/externalLinks';
import { useTheme } from '@/hooks/useTheme';
import { TranslationPanel } from '@/components/translation/TranslationPanel';
import type { Locale } from '@/i18n';
import type {
  CustomProviderDef,
  ProviderSettings,
} from '@/services/providers/providerConfigStorage';
import type { Model } from '@/services/modelRegistry/types';

export function TranslationToolHost() {
  // The popup is a separate Tauri window (separate JS realm) — the main
  // window's global auto-capitalize-off observer never reaches this realm,
  // so the translation input here needs its own.
  useDisableAutoCapitalize();

  // ponytail: same reason as useDisableAutoCapitalize — the main window's
  // external-link interceptor doesn't cross realms, so the translation
  // result's markdown links need their own or they hijack the popup webview.
  useEffect(() => installExternalLinkInterceptor(), []);

  // Theme sync (data-theme + code-highlight CSS) for this realm's DOM —
  // without it the popup renders in whatever data-theme the shared CSS
  // defaulted to, not the user's setting.
  useTheme();

  // ── Provider config sync ──
  // The TranslationPanel model selector (PairSelector) reads
  // `aiConfigStore.providerSettings` + `customerProviders` +
  // `modelRegistryStore.modelsByProvider`, which live in
  // ~/.folyn/providers/ and are loaded by the MAIN window. The main window
  // broadcasts them on `pet://providers-updated` (startProvidersBroadcast in
  // App.tsx); without this the popup would show "configure a model" even
  // though providers are configured, and translation would fail with the
  // noPair error. Mirrors the pet-panel listener.
  //
  // Request-response: the main window's initial emit fires at App.tsx mount
  // time, BEFORE this popup's webview mounts (the popup opens on user
  // action, long after startup). If the provider config is already loaded
  // and stable, no aiConfigStore change fires to push it again — so we emit
  // `pet://providers-request` after registering, and the main window
  // re-emits the current snapshot.
  //
  // Unmount race: unlike PetPanelApp (which never unmounts), this host
  // unmounts whenever the tool payload switches to a third-party tool — if
  // that lands before the awaited `listen()` resolves, the unlisten closure
  // would be lost and the listener would leak. The `disposed` flag
  // (ExtensionToolApp's blur-listener pattern) un-registers immediately in
  // that window instead; the other two listener effects below share it.
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        const { listen, emit } = await import('@tauri-apps/api/event');
        const un = await listen<{
          providerSettings?: Record<string, ProviderSettings>;
          customerProviders?: Record<string, CustomProviderDef>;
          modelsByProvider?: Record<string, Model[]>;
          extensionPair?: { provider: string; model: string } | null;
        }>('pet://providers-updated', (event) => {
          const p = event.payload ?? {};
          if (p.providerSettings) {
            useAiConfigStore.setState({
              providerSettings: p.providerSettings,
            });
          }
          if (p.customerProviders) {
            useAiConfigStore.setState({
              customerProviders: p.customerProviders,
            });
          }
          if (p.modelsByProvider) {
            useModelRegistryStore.setState({
              modelsByProvider: p.modelsByProvider,
            });
          }
          if (p.extensionPair !== undefined) {
            useAiConfigStore.setState({ extensionPair: p.extensionPair });
          }
        });
        if (disposed) un();
        else unlisten = un;
        // Request the current snapshot (the initial emit was missed) —
        // skip it if the host already unmounted.
        if (!disposed) await emit('pet://providers-request', {});
      } catch (err) {
        console.warn('[translation-tool] providers-updated listener failed:', err);
      }
    })();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // ── Cross-window settings hydration ──
  // The popup holds its own store instances (separate JS realm); without
  // this listener they would never see writes from the main window, because
  // those only update the main window's stores and broadcast via
  // `pet://settings-updated`. The translationStore slice (source/target/
  // input/result/prefs) hydrates from this broadcast — without it the popup
  // starts at defaults instead of the persisted
  // ~/.folyn/storage/translation.json state. Mirrors the pet-panel /
  // pet-bubble listeners — same channel, same `hydrateAllStores` call.
  // The startup broadcast can fire before this webview registers its
  // listener, so emit `pet://settings-request` after registering — the main
  // window answers with the current merged blob. Secondary windows hydrate
  // from the broadcast (NOT loadSettings — re-reading the storage files
  // directly would race the main window's writes).
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
            // Flip the persist gate so this popup's own setters (a language
            // switch, a new input) run persist() — without it their writes
            // are skipped and the prefs are lost on restart. Safe to call
            // repeatedly — idempotent. Those setters persist DIRECTLY:
            // persist() → storageClient.set → debounced writeTextFile to
            // ~/.folyn/storage/translation.json, permitted by the
            // narrowly-scoped fs grant in capabilities/extension-tool.json
            // ($HOME/.folyn/storage only; exists/mkdir/write-text-file —
            // no read), so the write lands on disk within ~300ms and
            // survives dev reload / Ctrl-C / crash (the quit-flush-only path
            // lost the popup's config on any non-graceful exit — the reported
            // restart-reset bug). The same persist also broadcasts
            // `pet://settings-updated`, keeping the OTHER realms (main window
            // + pet windows) in sync; the main window's quit-time
            // persistNow() flush stays as the safety net, and hydrating
            // here (NOT via loadSettings — re-reading the files directly
            // would race the main window's writes) keeps concurrent
            // main-window edits coherent.
            markSettingsHydrated();
          },
        );
        if (disposed) un();
        else unlisten = un;
        // Request the current snapshot (the startup broadcast was missed) —
        // skip it if the host already unmounted.
        if (!disposed) await emit('pet://settings-request', {});
      } catch (err) {
        console.warn('[translation-tool] settings-updated listener failed:', err);
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
  // popup's UI is locale-driven (language dropdowns, translate button,
  // errors), so without this listener it would stay in the language loaded
  // at launch. Mirrors the `locale://changed` listener in PetPanelApp.
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
        console.warn('[translation-tool] locale-changed listener setup failed:', err);
      }
    })();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // `embedded` adapts the chrome for this popup realm: compact
  // paddings/controls, an icon-only pair selector, and a hop to the main
  // window's AI settings via `pet://menu-action` instead of touching
  // navStore here. The pane layout stays left/right two-pane (input left,
  // result right), same as the main app's translation page — the narrow
  // stacked mode was for the pet-panel tab, which no longer embeds the
  // panel.
  return <TranslationPanel embedded />;
}
