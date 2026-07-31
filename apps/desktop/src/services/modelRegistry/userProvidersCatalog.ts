/**
 * User-data-dir cache for per-provider fetched model lists.
 *
 * Files at `~/.quill/providers/{providerId}/models.json` are the on-disk
 * mirror of the last successful fetch from the "获取模型" button. The
 * fetch path (modelRegistryStore → Tauri list_models) writes here on
 * success and reads back as fallback when a fetch fails — surfacing
 * "拉取失败，使用缓存数据" in the UI.
 *
 * On-disk shape is the same `Model[]` the store holds (post-merge with
 * the bundled catalog). Read/write primitives are generic over that
 * shape; the file is portable across installs.
 *
 * ponytail: the store also persists to `storage.json`'s `modelsByProvider`
 * slice (settingsPersistence). The file is a secondary, user-inspectable
 * cache — kept because the user explicitly asked for a file-based fallback.
 */

import { homeDir, join } from '@tauri-apps/api/path';
import { exists, mkdir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import type { Model } from './types';

/** On-disk shape: the fetched `Model[]` directly. */
export type ProviderModelsFile = Model[];

let cachedDir: string | null = null;

export async function getUserProvidersDir(): Promise<string> {
  if (cachedDir) return cachedDir;
  const home = await homeDir();
  cachedDir = await join(home, '.quill', 'providers');
  return cachedDir;
}

export async function readUserProviderModels(providerId: string): Promise<ProviderModelsFile | null> {
  try {
    const dir = await getUserProvidersDir();
    const filePath = await join(dir, providerId, 'models.json');
    if (!(await exists(filePath))) return null;
    const raw = await readTextFile(filePath);
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed as ProviderModelsFile;
  } catch {
    return null;
  }
}

export async function writeUserProviderModels(
  providerId: string,
  file: ProviderModelsFile,
): Promise<void> {
  const dir = await getUserProvidersDir();
  const providerDir = await join(dir, providerId);
  if (!(await exists(providerDir))) {
    await mkdir(providerDir, { recursive: true });
  }
  const filePath = await join(providerDir, 'models.json');
  await writeTextFile(filePath, JSON.stringify(file, null, 2) + '\n');
}

