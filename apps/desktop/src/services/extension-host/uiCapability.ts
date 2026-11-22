/**
 * UI capability (`api.ui`): send the user somewhere in the host — the system
 * browser, settings, the vault list — and show a count on the extension's own
 * page or panel button.
 */
import type { ExtensionManifest, UiApi } from 'folyn-extension-sdk';
import { useNavStore } from '@/store/navStore';
import { useExtensionPageStore } from '@/store/extensionPageStore';
import { useFeaturePanelStore } from '@/store/featurePanelStore';

/** `api.ui` plus its teardown (clears the badge). */
export interface UiCapability extends UiApi {
  dispose(): void;
}

export function buildExtensionUi(manifest: ExtensionManifest): UiCapability {
  let badge = 0;
  const applyBadge = () => {
    for (const page of manifest.contributes?.pages ?? []) {
      useExtensionPageStore.getState().setBadge(`ext:${manifest.id}.${page.id}`, badge);
    }
    for (const feature of manifest.contributes?.features ?? []) {
      useFeaturePanelStore.getState().setBadge(feature.id, badge);
    }
  };
  // Activation can set the badge before the contribution adapters register pages.
  const stopWatchingPages = useExtensionPageStore.subscribe((state, prev) => {
    if (state.pages.length !== prev.pages.length) applyBadge();
  });

  return {
    async openExternal(url) {
      const parsed = new URL(url);
      if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) {
        throw new Error('Only HTTP(S) URLs are supported');
      }
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(parsed.href);
    },
    openSettings() {
      const nav = useNavStore.getState();
      nav.setSettingsTab('models');
      nav.setCurrentPage('settings');
    },
    openVaults() {
      useNavStore.getState().setCurrentPage('vault');
    },
    setBadge(value) {
      badge = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
      applyBadge();
    },
    dispose() {
      stopWatchingPages();
      badge = 0;
      applyBadge();
    },
  };
}
