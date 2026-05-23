/** Provider type identifier */
export type ProviderType = 'tauri' | 'github' | 'webdav' | 's3' | 'custom';

/** Brand type to prevent path misuse across providers */
export type VaultPath<T extends ProviderType = ProviderType> = string & { __brand: T };

/** Declares what a provider supports */
export interface VaultCapabilities {
  writable: boolean;
  watch: boolean;
  search: boolean;
  history: boolean;
  sharing: boolean;
  streaming: boolean;
  offline: boolean;
}

/** A file or directory entry in a vault */
export interface VaultEntry {
  path: string;
  name: string;
  type: 'file' | 'dir';
  size?: number;
  lastModified?: Date;
  etag?: string;
  /** Nested children for directory entries (populated when using recursive listing) */
  children?: VaultEntry[];
}

/** Metadata for a vault entry */
export interface VaultMetadata {
  path: string;
  size: number;
  lastModified: Date;
  etag?: string;
  mimeType?: string;
}

/** History record for a file */
export interface VaultHistory {
  version: string;
  timestamp: Date;
  author?: string;
  message?: string;
}

/** Watch event emitted when files change */
export interface WatchEvent {
  type: 'create' | 'update' | 'delete';
  path: string;
  timestamp: Date;
}

/** Handle to stop watching */
export interface WatchHandle {
  dispose: () => void;
}

/** Watch callback */
export type WatchCallback = (events: WatchEvent[]) => void;

/** Vault configuration */
export interface VaultConfig {
  id: string;
  name: string;
  providerType: ProviderType;
  basePath: string;
  options?: Record<string, unknown>;
}

/** Vault error codes */
export type VaultErrorCode = 'NOT_FOUND' | 'PERMISSION_DENIED' | 'CONFLICT' | 'NETWORK_ERROR';

/** Custom error class for vault operations */
export class VaultError extends Error {
  constructor(
    public readonly code: VaultErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'VaultError';
  }
}
