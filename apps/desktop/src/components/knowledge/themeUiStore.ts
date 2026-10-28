import { create } from 'zustand';

/** Shared overlay entry for the sidebar and the workspace; no persisted domain state. */
export const useThemeUiStore = create<{ createOpen: boolean; setCreateOpen: (open: boolean) => void }>((set) => ({
  createOpen: false,
  setCreateOpen: (createOpen) => set({ createOpen }),
}));
