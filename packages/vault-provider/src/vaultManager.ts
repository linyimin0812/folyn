import type { VaultProvider } from './providerInterface';
import type {
  VaultCapabilities,
  VaultConfig,
  VaultEntry,
  VaultHistory,
  VaultMetadata,
  WatchCallback,
  WatchHandle,
} from './types';
import { VaultError } from './types';
import { VaultProviderRegistry } from './registry';

/**
 * High-level entry point for vault operations.
 * Manages the active provider and proxies all file operations.
 */
export class VaultManager {
  private provider: VaultProvider | null = null;
  private currentConfig: VaultConfig | null = null;

  /** Switch to a different vault by creating and connecting a new provider */
  async switchVault(config: VaultConfig): Promise<void> {
    if (this.provider) {
      await this.provider.disconnect();
    }

    const registry = VaultProviderRegistry.getInstance();
    this.provider = registry.create(config);
    await this.provider.connect(config);
    this.currentConfig = config;
  }

  /** Get the current provider (throws if none active) */
  private getProvider(): VaultProvider {
    if (!this.provider) {
      throw new VaultError('NOT_FOUND', 'No vault is currently active. Call switchVault() first.');
    }
    return this.provider;
  }

  /** Get current provider capabilities */
  getCapabilities(): VaultCapabilities | null {
    return this.provider?.capabilities ?? null;
  }

  /** Get current provider instance */
  getCurrentProvider(): VaultProvider | null {
    return this.provider;
  }

  /** Get current vault config */
  getCurrentConfig(): VaultConfig | null {
    return this.currentConfig;
  }

  // ── Proxied File Operations ──

  async readFile(path: string): Promise<string> {
    return this.getProvider().readFile(path);
  }

  async writeFile(path: string, content: string): Promise<void> {
    return this.getProvider().writeFile(path, content);
  }

  /** Write raw bytes — byte-preserving binary write. Falls back to the text
   *  `writeFile` for providers that don't implement `writeFileBytes` (the
   *  string is UTF-8-decoded from the bytes first, which is lossy for
   *  non-text — callers copying binary files should ensure the active
   *  provider implements this). */
  async writeFileBytes(path: string, bytes: Uint8Array): Promise<void> {
    const provider = this.getProvider();
    if (provider.writeFileBytes) {
      return provider.writeFileBytes(path, bytes);
    }
    // Lossy fallback — only reached for non-binary providers.
    return provider.writeFile(path, new TextDecoder().decode(bytes));
  }

  async deleteFile(path: string): Promise<void> {
    return this.getProvider().deleteFile(path);
  }

  async listFiles(path: string, recursive?: boolean, showHidden?: boolean): Promise<VaultEntry[]> {
    return this.getProvider().listFiles(path, recursive, showHidden);
  }

  async createDir(path: string): Promise<void> {
    return this.getProvider().createDir(path);
  }

  async deleteDir(path: string): Promise<void> {
    return this.getProvider().deleteDir(path);
  }

  async search(query: string): Promise<VaultEntry[]> {
    const provider = this.getProvider();
    if (!provider.search) {
      throw new VaultError('NOT_FOUND', 'Current provider does not support search');
    }
    return provider.search(query);
  }

  async getHistory(path: string): Promise<VaultHistory[]> {
    const provider = this.getProvider();
    if (!provider.getHistory) {
      throw new VaultError('NOT_FOUND', 'Current provider does not support history');
    }
    return provider.getHistory(path);
  }

  watch(callback: WatchCallback): WatchHandle {
    const provider = this.getProvider();
    if (!provider.watch) {
      throw new VaultError('NOT_FOUND', 'Current provider does not support watch');
    }
    return provider.watch(callback);
  }

  async getMetadata(path: string): Promise<VaultMetadata> {
    const provider = this.getProvider();
    if (!provider.getMetadata) {
      throw new VaultError('NOT_FOUND', 'Current provider does not support metadata');
    }
    return provider.getMetadata(path);
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const provider = this.getProvider();
    if (provider.rename) {
      return provider.rename(oldPath, newPath);
    }
    const content = await provider.readFile(oldPath);
    await provider.writeFile(newPath, content);
    await provider.deleteFile(oldPath);
  }

  /** Disconnect and clean up */
  async dispose(): Promise<void> {
    if (this.provider) {
      await this.provider.disconnect();
      this.provider = null;
      this.currentConfig = null;
    }
  }
}
