import { create } from 'zustand';
import type { AppPage, SettingsTab } from './settingsStore';

// ponytail: navStore holds runtime-only navigation state (currentPage,
// settingsTab) that must NOT be persisted — matches the old settingsStore
// PERSIST_KEYS allowlist which deliberately excludes both fields. No hydrate,
// no schedulePersist registration. PR2 will retarget the AppPage/SettingsTab
// type re-exports once consumers migrate off settingsStore.

export interface NavState {
  currentPage: AppPage;
  settingsTab: SettingsTab;
  setCurrentPage: (page: AppPage) => void;
  setSettingsTab: (tab: SettingsTab) => void;
}

export const useNavStore = create<NavState>((set) => ({
  currentPage: 'editor',
  settingsTab: 'appearance',
  setCurrentPage: (page) => set({ currentPage: page }),
  setSettingsTab: (tab) => set({ settingsTab: tab }),
}));
