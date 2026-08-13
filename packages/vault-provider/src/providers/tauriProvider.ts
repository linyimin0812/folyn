import type { VaultProvider } from '../providerInterface';
import type { ProviderType, VaultCapabilities, VaultConfig, VaultEntry } from '../types';
import { VaultError } from '../types';
import {
  readTextFile,
  writeTextFile,
  writeFile as writeFileBytes,
  readFile as readFileBytesRaw,
  remove,
  mkdir,
  readDir,
  exists,
  stat,
  rename as fsRename,
} from '@tauri-apps/plugin-fs';
import { join, dirname } from '@tauri-apps/api/path';

export class TauriVaultProvider implements VaultProvider {
  // ponytail: typed as interface types (not literals) so the
  // GithubVaultProvider subclass can override identity with its own values.
  readonly id: string = 'tauri';
  readonly type: ProviderType = 'tauri' as any;
  readonly displayName: string = '本地文件';
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
    let base = config.basePath;
    if (base.startsWith('~')) {
      const home = await this.getHome();
      base = await join(home, base.slice(1));
    }
    this.basePath = base.replace(/[/\\]+$/, '');

    const dirExists = await exists(this.basePath);
    if (!dirExists) {
      await mkdir(this.basePath, { recursive: true });
    }
  }

  async disconnect(): Promise<void> {
    this.basePath = '';
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

  /** Read raw bytes — byte-preserving (binary) read. Mirrors `writeFileBytes`.
   *  Use for binary copies where a UTF-8 string round-trip would corrupt
   *  non-text bytes. */
  async readFileBytes(path: string): Promise<Uint8Array> {
    const fullPath = await this.resolve(path);
    try {
      return await readFileBytesRaw(fullPath);
    } catch (err) {
      throw new VaultError('NOT_FOUND', `File not found: ${path}`);
    }
  }

  async writeFile(path: string, content: string): Promise<void> {
    const fullPath = await this.resolve(path);
    // ponytail: use Tauri's dirname (Rust-backed, separator-aware) instead of
    // lastIndexOf('/'). On Windows, join() returns backslash-separated paths,
    // so lastIndexOf('/') returns -1 → substring(0, -1) === '' → exists('')
    // throws "forbidden path:" (empty path, out of fs scope). This was the
    // Windows startup crash: every writeFile parent-check hit an empty path.
    const parentDir = await dirname(fullPath);
    if (parentDir) {
      const parentExists = await exists(parentDir);
      if (!parentExists) {
        await mkdir(parentDir, { recursive: true });
      }
    }
    await writeTextFile(fullPath, content);
  }

  /** Write raw bytes — byte-preserving (binary) write. Mirrors `writeFile`'s
   *  parent-dir creation. Use for binary copies where a UTF-8 string
   *  round-trip would corrupt non-text bytes. */
  async writeFileBytes(path: string, bytes: Uint8Array): Promise<void> {
    const fullPath = await this.resolve(path);
    // ponytail: see writeFile — dirname is separator-aware (Windows fix).
    const parentDir = await dirname(fullPath);
    if (parentDir) {
      const parentExists = await exists(parentDir);
      if (!parentExists) {
        await mkdir(parentDir, { recursive: true });
      }
    }
    await writeFileBytes(fullPath, bytes);
  }

  async deleteFile(path: string): Promise<void> {
    const fullPath = await this.resolve(path);
    try {
      await remove(fullPath);
    } catch (err) {
      // ponytail: surface the original fs error instead of swallowing it into
      // a vague NOT_FOUND — the underlying remove() can fail for many reasons
      // (scope ACL denial, EBUSY, ENOTEMPTY, EACCES, path resolution) and the
      // caller needs the actual reason to debug. NOT_FOUND is misleading
      // (suggests the file is gone) when the real cause is often a permission
      // or scope issue on a file that definitely exists.
      throw new VaultError('NOT_FOUND', `Cannot delete: ${path} (${err})`);
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
      // ponytail: surface the original fs error — see deleteFile comment. The
      // user's `.voice_input` delete failure was silently masked as NOT_FOUND,
      // hiding the real reason (scope denial / EBUSY / open handle). Including
      // `${err}` exposes the underlying plugin:fs|remove rejection string so
      // the next iteration can actually root-cause instead of guessing.
      throw new VaultError('NOT_FOUND', `Cannot delete directory: ${path} (${err})`);
    }
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const fullOld = await this.resolve(oldPath);
    const fullNew = await this.resolve(newPath);
    // ponytail: see writeFile — dirname is separator-aware (Windows fix).
    const parentDir = await dirname(fullNew);
    if (parentDir) {
      const parentExists = await exists(parentDir);
      if (!parentExists) {
        await mkdir(parentDir, { recursive: true });
      }
    }
    await fsRename(fullOld, fullNew);
  }
}
