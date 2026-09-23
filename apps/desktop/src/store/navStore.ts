import { create } from 'zustand';

// ponytail: navStore owns AppPage/SettingsTab type ownership (migrated
// from legacy settingsStore). These are nav-domain discriminators.

// `(string & {})` open tail (same trick as SDK PresentationModeId): extension
// pages register `ext:<extensionId>.<pageId>` ids at runtime. Literal
// comparisons (`currentPage === 'editor'`) keep narrowing; there is no
// exhaustive switch on AppPage.
export type AppPage = 'editor' | 'vault' | 'settings' | 'translation' | 'activity' | (string & {});
export type SettingsTab = 'appearance' | 'editor' | 'shortcuts' | 'vault' | 'sync' | 'cli' | 'models' | 'voice' | 'templates' | 'pet' | 'extensions' | 'notifications' | 'storage' | 'about';

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
