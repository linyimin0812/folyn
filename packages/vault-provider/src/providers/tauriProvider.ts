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
  exists,
  rename as fsRename,
} from '@tauri-apps/plugin-fs';
import { join, dirname } from '@tauri-apps/api/path';
import { invoke } from '@tauri-apps/api/core';

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

  async listFiles(path: string, recursive?: boolean, showHidden?: boolean, exclude?: string[]): Promise<VaultEntry[]> {
    const fullPath = await this.resolve(path);
    try {
      // One IPC round-trip: Rust walks the tree in-process and returns a flat,
      // nested list of relative-path entries. This replaces one-readDir-per-dir
      // (and one-stat-per-file) which made vault add/switch crawl on large dirs.
      // `exclude` is pruned during the Rust walk so heavy dirs (.git/node_modules)
      // are never recursed into or shipped over IPC.
      const raw = await invoke<
        { path: string; name: string; is_dir: boolean; children?: unknown[] | null }[]
      >('scan_file_tree', {
        root: fullPath,
        showHidden: !!showHidden,
        exclude: exclude ?? [],
      });

      // Rust already returns vault-relative paths (e.g. 'sub/file.md'),
      // so use them directly — don't rebuild from name (that drops dir prefixes).
      const prefix = path ? `${path}/` : '';
      const convert = (
        items: { path: string; name: string; is_dir: boolean; children?: unknown[] | null }[],
      ): VaultEntry[] =>
        items
          .map((e) => {
            const type: VaultEntry['type'] = e.is_dir ? 'dir' : 'file';
            const children = e.is_dir && Array.isArray(e.children) ? convert(e.children as typeof items) : undefined;
            return { path: `${prefix}${e.path}`, name: e.name, type, children };
          })
          .sort((a, b) => (a.type !== b.type ? (a.type === 'dir' ? -1 : 1) : a.name.localeCompare(b.name)));

      const result = convert(raw);
      return recursive ? result : result.map(({ ...e }) => ({ ...e, children: undefined }));
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
