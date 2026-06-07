import { BaseVaultProvider } from './baseProvider';
import type { VaultCapabilities, VaultEntry } from '../types';

export class WebDAVVaultProvider extends BaseVaultProvider {
  readonly id = 'webdav';
  readonly type = 'webdav' as const;
  readonly displayName = 'WebDAV';
  readonly capabilities: VaultCapabilities = {
    writable: true, watch: false, search: false,
    history: false, sharing: false, streaming: false, offline: false,
  };

  async readFile(path: string): Promise<string> {
    return `[WebDAVProvider] Content of ${path}`;
  }

  async writeFile(path: string, content: string): Promise<void> {
    console.log(`[WebDAVProvider] Write ${path}: ${content.length} chars`);
  }

  async deleteFile(path: string): Promise<void> {
    console.log(`[WebDAVProvider] Delete ${path}`);
  }

  async listFiles(_path: string): Promise<VaultEntry[]> {
    return [];
  }

  async createDir(path: string): Promise<void> {
    console.log(`[WebDAVProvider] CreateDir ${path}`);
  }

  async deleteDir(path: string): Promise<void> {
    console.log(`[WebDAVProvider] DeleteDir ${path}`);
  }
}
