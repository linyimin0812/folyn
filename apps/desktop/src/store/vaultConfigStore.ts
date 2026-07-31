import { create } from 'zustand';
import { registerPersistSlice, schedulePersist } from './settingsPersistence';

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
  vaultPath: '~/Documents/quill/my-notes',
  imagePath: 'assets/images/',
  docExtension: '.md',
  watchFileChanges: true,
  trashOnDelete: true,

  setVaultPath: (v) => { set({ vaultPath: v }); schedulePersist(); },
  setImagePath: (v) => { set({ imagePath: v }); schedulePersist(); },
  setDocExtension: (v) => { set({ docExtension: v }); schedulePersist(); },
  setWatchFileChanges: (v) => { set({ watchFileChanges: v }); schedulePersist(); },
  setTrashOnDelete: (v) => { set({ trashOnDelete: v }); schedulePersist(); },

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

registerPersistSlice({
  name: 'vault',
  keys: PERSIST_KEYS_VAULT_CONFIG,
  getState: () => useVaultConfigStore.getState() as unknown as Record<string, unknown>,
  hydrate: (blob) => useVaultConfigStore.getState().hydrate(blob),
});
