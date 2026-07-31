import { readTextFile, writeTextFile, mkdir, exists, readDir, remove } from '@tauri-apps/plugin-fs';
import { homeDir, join } from '@tauri-apps/api/path';

let basePath = '';

async function getBasePath(): Promise<string> {
  if (basePath) return basePath;
  const home = await homeDir();
  basePath = await join(home, '.quill', 'vaults');
  return basePath;
}

async function getVaultDir(vaultId: string): Promise<string> {
  const base = await getBasePath();
  return join(base, vaultId);
}

async function ensureDir(dirPath: string): Promise<void> {
  const dirExists = await exists(dirPath);
  if (!dirExists) {
    await mkdir(dirPath, { recursive: true });
  }
}

export interface SessionMeta {
  activeSessionId: string | null;
}

export const sessionStorage = {
  async saveSession(vaultId: string, sessionId: string, data: unknown): Promise<void> {
    const dir = await getVaultDir(vaultId);
    await ensureDir(dir);
    const filePath = await join(dir, `${sessionId}.json`);
    await writeTextFile(filePath, JSON.stringify(data));
  },

  async loadSession<T>(vaultId: string, sessionId: string): Promise<T | null> {
    const dir = await getVaultDir(vaultId);
    const filePath = await join(dir, `${sessionId}.json`);
    try {
      const fileExists = await exists(filePath);
      if (!fileExists) return null;
      const raw = await readTextFile(filePath);
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  },

  async deleteSession(vaultId: string, sessionId: string): Promise<void> {
    const dir = await getVaultDir(vaultId);
    const filePath = await join(dir, `${sessionId}.json`);
    try {
      const fileExists = await exists(filePath);
      if (fileExists) await remove(filePath);
    } catch { /* ignore */ }
  },

  async listSessionIds(vaultId: string): Promise<string[]> {
    const dir = await getVaultDir(vaultId);
    try {
      const dirExists = await exists(dir);
      if (!dirExists) return [];
      const entries = await readDir(dir);
      return entries
        .filter((e) => e.name?.endsWith('.json') && e.name !== '_meta.json')
        .map((e) => e.name!.replace('.json', ''));
    } catch {
      return [];
    }
  },

  async saveMeta(vaultId: string, meta: SessionMeta): Promise<void> {
    const dir = await getVaultDir(vaultId);
    await ensureDir(dir);
    const filePath = await join(dir, '_meta.json');
    await writeTextFile(filePath, JSON.stringify(meta));
  },

  async loadMeta(vaultId: string): Promise<SessionMeta | null> {
    const dir = await getVaultDir(vaultId);
    const filePath = await join(dir, '_meta.json');
    try {
      const fileExists = await exists(filePath);
      if (!fileExists) return null;
      const raw = await readTextFile(filePath);
      return JSON.parse(raw) as SessionMeta;
    } catch {
      return null;
    }
  },
};
