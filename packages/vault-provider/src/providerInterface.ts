import type {
  ProviderType,
  VaultCapabilities,
  VaultConfig,
  VaultEntry,
  VaultHistory,
  VaultMetadata,
  WatchCallback,
  WatchHandle,
} from './types';

/**
 * Core interface that all vault providers must implement.
 * Provides a unified API for file operations across different storage backends.
 */
export interface VaultProvider {
  /** Unique identifier for this provider instance */
  readonly id: string;

  /** Provider type (local, github, webdav, s3, custom) */
  readonly type: ProviderType;

  /** Human-readable display name */
  readonly displayName: string;

  /** Declares supported capabilities */
  readonly capabilities: VaultCapabilities;

  // ── Lifecycle ──

  /** Connect to the storage backend */
  connect(config: VaultConfig): Promise<void>;

  /** Disconnect from the storage backend */
  disconnect(): Promise<void>;

  /** Check if the backend is reachable */
  ping(): Promise<boolean>;

  // ── File Operations ──

  /** Read file content as UTF-8 string */
  readFile(path: string): Promise<string>;

  /** Write content to a file (create or overwrite) */
  writeFile(path: string, content: string): Promise<void>;

  /** Write raw bytes to a file (byte-preserving, for binary copies).
   *  Optional — providers that don't support binary write leave this
   *  undefined and callers fall back to the text `writeFile`. */
  writeFileBytes?(path: string, bytes: Uint8Array): Promise<void>;

  /** Read raw bytes from a file (byte-preserving, for binary copies).
   *  Optional — mirrors `writeFileBytes`. Providers that don't support
   *  binary read leave this undefined and callers fall back to the text
   *  `readFile` (UTF-8 encode, lossy for non-text). */
  readFileBytes?(path: string): Promise<Uint8Array>;

  /** Delete a file */
  deleteFile(path: string): Promise<void>;

  /** List files and directories at the given path */
  listFiles(path: string, recursive?: boolean, showHidden?: boolean, exclude?: string[]): Promise<VaultEntry[]>;

  // ── Directory Operations ──

  /** Create a directory (and parents if needed) */
  createDir(path: string): Promise<void>;

  /** Delete a directory and its contents */
  deleteDir(path: string): Promise<void>;

  /** Rename/move a file or directory */
  rename?(oldPath: string, newPath: string): Promise<void>;

  // ── Advanced (optional based on capabilities) ──

  /** Full-text search across vault files */
  search?(query: string): Promise<VaultEntry[]>;

  /** Get version history for a file */
  getHistory?(path: string): Promise<VaultHistory[]>;

  /** Watch for file changes */
  watch?(callback: WatchCallback): WatchHandle;

  /** Get metadata for a file or directory */
  getMetadata?(path: string): Promise<VaultMetadata>;
}
