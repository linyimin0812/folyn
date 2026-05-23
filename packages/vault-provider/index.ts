export type { VaultProvider } from './src/provider.interface';
export type {
  ProviderType,
  VaultPath,
  VaultCapabilities,
  VaultEntry,
  VaultMetadata,
  VaultHistory,
  WatchEvent,
  WatchHandle,
  WatchCallback,
  VaultConfig,
  VaultErrorCode,
} from './src/types';
export { VaultError } from './src/types';
export { VaultProviderRegistry } from './src/registry';
export type { VaultProviderDescriptor } from './src/registry';
export { VaultManager } from './src/vault.manager';
export { TauriVaultProvider } from './src/providers/tauri.provider';
