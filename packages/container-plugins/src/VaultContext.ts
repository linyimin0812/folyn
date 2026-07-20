import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

/**
 * Context that hosts ambient vault state for container plugins
 * that need filesystem access (e.g. file-preview). Supplied by the
 * desktop preview host; null when no host is available.
 */
export interface VaultContextValue {
  /** Absolute path to the vault root (already tilde-expanded). */
  vaultRoot: string;
  /** Path of the document currently being rendered. */
  filePath: string;
  /** Read a file's text content by absolute or vault-relative path. */
  readFile: (path: string) => Promise<string>;
  /**
   * Render a file's content with its registered file-type Preview component
   * (markdown, dbml, json, csv, etc.). Returns null if no handler matches,
   * in which case the caller should fall back to a plain-text dump.
   */
  renderFile?: (path: string, content: string) => ReactNode;
  /** Open a file in the editor (vault-relative path). */
  openFile?: (path: string) => void;
  /** Resolve a file-type icon for a path/filename; null when no host resolver. */
  getFileIcon?: (path: string) => ReactNode;
}

export const VaultContext = createContext<VaultContextValue | null>(null);

export function useVaultContext(): VaultContextValue | null {
  return useContext(VaultContext);
}
