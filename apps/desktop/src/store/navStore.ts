import { create } from 'zustand';

// ponytail: navStore owns AppPage/SettingsTab type ownership (migrated
// from legacy settingsStore). These are nav-domain discriminators.

export type AppPage = 'editor' | 'vault' | 'settings' | 'schedule' | 'study';
export type SettingsTab = 'appearance' | 'editor' | 'shortcuts' | 'vault' | 'sync' | 'cli' | 'models' | 'voice' | 'templates' | 'pet' | 'plugins' | 'notifications' | 'csp' | 'storage' | 'wiki' | 'about';

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
