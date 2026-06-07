import { BaseVaultProvider } from './baseProvider';
import type { VaultCapabilities, VaultEntry, WatchCallback, WatchHandle } from '../types';

export class GitHubVaultProvider extends BaseVaultProvider {
  readonly id = 'github';
  readonly type = 'github' as const;
  readonly displayName = 'GitHub 仓库';
  readonly capabilities: VaultCapabilities = {
    writable: true, watch: false, search: true,
    history: true, sharing: true, streaming: false, offline: false,
  };

  async readFile(path: string): Promise<string> {
    // In production: use @octokit/rest
    return `[GitHubProvider] Content of ${path}`;
  }

  async writeFile(path: string, content: string): Promise<void> {
    console.log(`[GitHubProvider] Write ${path}: ${content.length} chars`);
  }

  async deleteFile(path: string): Promise<void> {
    console.log(`[GitHubProvider] Delete ${path}`);
  }

  async listFiles(_path: string): Promise<VaultEntry[]> {
    return [];
  }

  async createDir(path: string): Promise<void> {
    console.log(`[GitHubProvider] CreateDir ${path}`);
  }

  async deleteDir(path: string): Promise<void> {
    console.log(`[GitHubProvider] DeleteDir ${path}`);
  }

  async search(query: string): Promise<VaultEntry[]> {
    console.log(`[GitHubProvider] Search: ${query}`);
    return [];
  }

  async getHistory(path: string): Promise<Array<{ version: string; date: string; author: string }>> {
    console.log(`[GitHubProvider] GetHistory: ${path}`);
    return [];
  }

  watch(_callback: WatchCallback): WatchHandle {
    const interval = setInterval(async () => {
      // Poll for changes every 30s
    }, 30000);
    return { dispose: () => clearInterval(interval) };
  }
}
