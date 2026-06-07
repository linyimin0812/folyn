import type { VaultProvider } from '../providerInterface';
import type { VaultCapabilities, VaultConfig, VaultEntry, ProviderType } from '../types';

export abstract class BaseVaultProvider implements VaultProvider {
  abstract readonly id: string;
  abstract readonly type: ProviderType;
  abstract readonly displayName: string;
  abstract readonly capabilities: VaultCapabilities;

  protected config: VaultConfig | null = null;

  async connect(config: VaultConfig): Promise<void> {
    this.config = config;
  }

  async disconnect(): Promise<void> {
    this.config = null;
  }

  async ping(): Promise<boolean> {
    return this.config !== null;
  }

  abstract readFile(path: string): Promise<string>;
  abstract writeFile(path: string, content: string): Promise<void>;
  abstract deleteFile(path: string): Promise<void>;
  abstract listFiles(path: string, recursive?: boolean, showHidden?: boolean): Promise<VaultEntry[]>;
  abstract createDir(path: string): Promise<void>;
  abstract deleteDir(path: string): Promise<void>;
}
