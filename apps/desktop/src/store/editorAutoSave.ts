/** Debounced auto-save timers per tab */
const autoSaveTimers = new Map<string, ReturnType<typeof setTimeout>>();
const AUTO_SAVE_DELAY_MS = 1000;

export function scheduleAutoSave(
  tabId: string,
  saveFn: (tabId: string) => Promise<void>,
) {
  const existing = autoSaveTimers.get(tabId);
  if (existing) clearTimeout(existing);
  autoSaveTimers.set(
    tabId,
    setTimeout(() => {
      autoSaveTimers.delete(tabId);
      saveFn(tabId);
    }, AUTO_SAVE_DELAY_MS),
  );
}

export async function flushAllAutoSaves(
  saveFn: (tabId: string) => Promise<void>,
) {
  const pending = Array.from(autoSaveTimers.keys());
  for (const tabId of pending) {
    const timer = autoSaveTimers.get(tabId);
    if (timer) clearTimeout(timer);
    autoSaveTimers.delete(tabId);
  }
  await Promise.allSettled(pending.map((tabId) => saveFn(tabId)));
}
