import { BaseVaultProvider } from './baseProvider';
import type { VaultCapabilities, VaultEntry } from '../types';

export class S3VaultProvider extends BaseVaultProvider {
  readonly id = 's3';
  readonly type = 's3' as const;
  readonly displayName = 'S3 / R2';
  readonly capabilities: VaultCapabilities = {
    writable: true, watch: false, search: true,
    history: false, sharing: false, streaming: true, offline: false,
  };

  async readFile(path: string): Promise<string> {
    return `[S3Provider] Content of ${path}`;
  }

  async writeFile(path: string, content: string): Promise<void> {
    console.log(`[S3Provider] Write ${path}: ${content.length} chars`);
  }

  async deleteFile(path: string): Promise<void> {
    console.log(`[S3Provider] Delete ${path}`);
  }

  async listFiles(_path: string): Promise<VaultEntry[]> {
    return [];
  }

  async createDir(path: string): Promise<void> {
    console.log(`[S3Provider] CreateDir ${path}`);
  }

  async deleteDir(path: string): Promise<void> {
    console.log(`[S3Provider] DeleteDir ${path}`);
  }

  async search(query: string): Promise<VaultEntry[]> {
    console.log(`[S3Provider] Search: ${query}`);
    return [];
  }
}
