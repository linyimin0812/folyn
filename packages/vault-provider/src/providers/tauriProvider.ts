import { BaseVaultProvider } from './baseProvider';
import type { VaultCapabilities, VaultConfig, VaultEntry } from '../types';
import { VaultError } from '../types';
import {
  readTextFile,
  writeTextFile,
  remove,
  mkdir,
  readDir,
  exists,
  stat,
  rename as fsRename,
} from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';

export class TauriVaultProvider extends BaseVaultProvider {
  readonly id = 'tauri';
  readonly type: 'tauri' = 'tauri' as any;
  readonly displayName = '本地文件';
  readonly capabilities: VaultCapabilities = {
    writable: true,
    watch: false,
    search: false,
    history: false,
    sharing: false,
    streaming: false,
    offline: true,
  };

  private basePath = '';

  async connect(config: VaultConfig): Promise<void> {
    await super.connect(config);
    let base = config.basePath;
    if (base.startsWith('~')) {
      const home = (await this.getHome()).replace(/\/+$/, '');
      base = home + base.slice(1);
    }
    this.basePath = base.replace(/\/+$/, '');

    const dirExists = await exists(this.basePath);
    if (!dirExists) {
      await mkdir(this.basePath, { recursive: true });
    }
  }

  async ping(): Promise<boolean> {
    return true;
  }

  private async getHome(): Promise<string> {
    const { homeDir } = await import('@tauri-apps/api/path');
    return await homeDir();
  }

  private async resolve(path: string): Promise<string> {
    if (!path || path === '' || path === '.') return this.basePath;
    return await join(this.basePath, path);
  }

  async readFile(path: string): Promise<string> {
    const fullPath = await this.resolve(path);
    try {
      return await readTextFile(fullPath);
    } catch (err) {
      throw new VaultError('NOT_FOUND', `File not found: ${path}`);
    }
  }

  async writeFile(path: string, content: string): Promise<void> {
    const fullPath = await this.resolve(path);
    const parentDir = fullPath.substring(0, fullPath.lastIndexOf('/'));
    const parentExists = await exists(parentDir);
    if (!parentExists) {
      await mkdir(parentDir, { recursive: true });
    }
    await writeTextFile(fullPath, content);
  }

  async deleteFile(path: string): Promise<void> {
    const fullPath = await this.resolve(path);
    try {
      await remove(fullPath);
    } catch (err) {
      throw new VaultError('NOT_FOUND', `Cannot delete: ${path}`);
    }
  }

  async listFiles(path: string, recursive?: boolean, showHidden?: boolean): Promise<VaultEntry[]> {
    const fullPath = await this.resolve(path);
    try {
      const dirExists = await exists(fullPath);
      if (!dirExists) return [];
      const entries = await readDir(fullPath);
      const result: VaultEntry[] = [];

      for (const entry of entries) {
        if (!showHidden && entry.name.startsWith('.')) continue;

        const entryPath = path ? `${path}/${entry.name}` : entry.name;
        const fullEntryPath = await join(fullPath, entry.name);

        if (entry.isDirectory) {
          const dirEntry: VaultEntry = {
            path: entryPath,
            name: entry.name,
            type: 'dir',
          };
          if (recursive) {
            try {
              dirEntry.children = await this.listFiles(entryPath, true, showHidden);
            } catch {
              dirEntry.children = [];
            }
          }
          result.push(dirEntry);
        } else if (entry.isFile) {
          let fileSize: number | undefined;
          let lastModified: Date | undefined;
          try {
            const fileStat = await stat(fullEntryPath);
            fileSize = fileStat.size;
            lastModified = fileStat.mtime ? new Date(fileStat.mtime) : undefined;
          } catch {
            // stat may fail on some special files
          }
          result.push({
            path: entryPath,
            name: entry.name,
            type: 'file',
            size: fileSize,
            lastModified,
          });
        }
      }

      result.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      return result;
    } catch (err) {
      throw new VaultError('NOT_FOUND', `Cannot list: ${path} (${err})`);
    }
  }

  async createDir(path: string): Promise<void> {
    const fullPath = await this.resolve(path);
    await mkdir(fullPath, { recursive: true });
  }

  async deleteDir(path: string): Promise<void> {
    const fullPath = await this.resolve(path);
    try {
      await remove(fullPath, { recursive: true });
    } catch (err) {
      throw new VaultError('NOT_FOUND', `Cannot delete directory: ${path}`);
    }
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const fullOld = await this.resolve(oldPath);
    const fullNew = await this.resolve(newPath);
    const parentDir = fullNew.substring(0, fullNew.lastIndexOf('/'));
    const parentExists = await exists(parentDir);
    if (!parentExists) {
      await mkdir(parentDir, { recursive: true });
    }
    await fsRename(fullOld, fullNew);
  }
}
