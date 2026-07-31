import { debounceByKey } from '@/utils/debounce';

/** Per-tab debounced auto-save: each tab tracks its own trailing-edge timer. */
const AUTO_SAVE_DELAY_MS = 5000;
const autoSaveTimers = debounceByKey<string>(AUTO_SAVE_DELAY_MS);

export function scheduleAutoSave(
  tabId: string,
  saveFn: (tabId: string) => Promise<void>,
) {
  autoSaveTimers.schedule(tabId, () => { void saveFn(tabId); });
}

export async function flushAllAutoSaves(
  saveFn: (tabId: string) => Promise<void>,
) {
  const pending = autoSaveTimers.clearAll();
  await Promise.allSettled(pending.map((tabId) => saveFn(tabId)));
}
