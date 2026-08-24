import { create } from 'zustand';
import { registerPersistSlice } from './settingsPersistence';

export const PERSIST_KEYS_VAULT_CONFIG = [
  'vaultPath',
  'imagePath',
  'docExtension',
  'watchFileChanges',
  'trashOnDelete',
] as const;

export interface VaultConfigState {
  vaultPath: string;
  imagePath: string;
  docExtension: string;
  watchFileChanges: boolean;
  trashOnDelete: boolean;

  setVaultPath: (v: string) => void;
  setImagePath: (v: string) => void;
  setDocExtension: (v: string) => void;
  setWatchFileChanges: (v: boolean) => void;
  setTrashOnDelete: (v: boolean) => void;

  /** Load this store's slice from the persisted `settings:all` blob. */
  hydrate: (blob: Record<string, unknown>) => void;
}

export const useVaultConfigStore = create<VaultConfigState>((set) => ({
  vaultPath: '~/Documents/mochi/my-notes',
  imagePath: 'assets/images/',
  docExtension: '.md',
  watchFileChanges: true,
  trashOnDelete: true,

  setVaultPath: (v) => { set({ vaultPath: v }); persist(); },
  setImagePath: (v) => { set({ imagePath: v }); persist(); },
  setDocExtension: (v) => { set({ docExtension: v }); persist(); },
  setWatchFileChanges: (v) => { set({ watchFileChanges: v }); persist(); },
  setTrashOnDelete: (v) => { set({ trashOnDelete: v }); persist(); },

  hydrate: (blob) => {
    const patch: Partial<VaultConfigState> = {};
    if (blob.vaultPath !== undefined) patch.vaultPath = blob.vaultPath as string;
    if (blob.imagePath !== undefined) patch.imagePath = blob.imagePath as string;
    if (blob.docExtension !== undefined) patch.docExtension = blob.docExtension as string;
    if (blob.watchFileChanges !== undefined) patch.watchFileChanges = blob.watchFileChanges as boolean;
    if (blob.trashOnDelete !== undefined) patch.trashOnDelete = blob.trashOnDelete as boolean;
    if (Object.keys(patch).length > 0) set(patch);
  },
}));

const persist = registerPersistSlice({
  name: 'vault',
  keys: PERSIST_KEYS_VAULT_CONFIG,
  getState: () => useVaultConfigStore.getState() as unknown as Record<string, unknown>,
  hydrate: (blob) => useVaultConfigStore.getState().hydrate(blob),
});
