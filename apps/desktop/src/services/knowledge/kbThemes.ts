import { kbWriteAtomic, vaultKbFs, type KbFs } from './kbFs';
import { kbThemeRegistryPath, kbThemeRoot } from './kbPaths';

export interface KbTheme { id: string; name: string }
export interface KbThemeRegistry { themes: KbTheme[]; activeThemeId: string | null }

export function themeKbFs(vaultId: string, themeId: string): KbFs {
  return { ...vaultKbFs(vaultId), root: kbThemeRoot(themeId) };
}

export async function readThemeRegistry(fs: KbFs): Promise<KbThemeRegistry> {
  let text: string;
  try { text = await fs.readFile(kbThemeRegistryPath); }
  catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
    if (code === 'NOT_FOUND' || /ENOENT|No such file|not found|does not exist/i.test(String(error))) return { themes: [], activeThemeId: null };
    throw error;
  }
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== 'object' || !('themes' in value) || !Array.isArray(value.themes) || !('activeThemeId' in value)) throw new Error('知识主题目录格式无效，请检查 themes.json。');
  const themes: KbTheme[] = value.themes.map((theme: unknown) => {
    if (!theme || typeof theme !== 'object' || !('id' in theme) || !('name' in theme) || typeof theme.id !== 'string' || typeof theme.name !== 'string' || !theme.name.trim()) throw new Error('知识主题目录包含无效主题。');
    kbThemeRoot(theme.id);
    return { id: theme.id, name: theme.name };
  });
  if (new Set(themes.map((theme) => theme.id)).size !== themes.length) throw new Error('知识主题目录包含重复标识。');
  const activeThemeId = value.activeThemeId;
  if (activeThemeId !== null && (typeof activeThemeId !== 'string' || !themes.some((theme) => theme.id === activeThemeId))) throw new Error('知识主题目录的当前选择无效。');
  return { themes, activeThemeId };
}

// Serialize read-modify-write of one registry; each operation owns its fixed Vault FS.
const queues = new Map<string, Promise<unknown>>();
export function updateThemeRegistry(vaultId: string, update: (registry: KbThemeRegistry) => void): Promise<KbThemeRegistry> {
  const previous = queues.get(vaultId) ?? Promise.resolve();
  const operation = previous.catch(() => undefined).then(async () => {
    const fs = vaultKbFs(vaultId);
    const registry = await readThemeRegistry(fs);
    update(registry);
    await kbWriteAtomic(fs, kbThemeRegistryPath, JSON.stringify(registry, null, 2));
    return registry;
  });
  queues.set(vaultId, operation);
  return operation;
}
