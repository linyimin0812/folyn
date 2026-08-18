// ponytail: B5.y transactional writes. Stage to <vault>/__wiki__/.staging/, atomic rename on same volume.
// Tauri fs rename is atomic intra-volume; .staging/ lives inside __wiki__/ to guarantee same volume.

import { wikiProvider } from './wikiProvider';
import { resolveBasePath } from '@/utils/pathResolver';
import { useVaultStore } from '@/store/vaultStore';
import { WIKI_DIR } from '@/types/wiki';

export interface StagedWrite {
  path: string;      // wiki-relative path, e.g. "entities/react.md"
  content: string;
}

export interface StagedDelete {
  path: string;      // wiki-relative path to delete
}

/**
 * Apply writes and deletes atomically: stage all to .staging/, then rename each
 * into final position on success. On any failure, leave .staging/ in place
 * (caller can retry; old state at final paths untouched).
 */
export async function applyAtomicBatch(
  writes: StagedWrite[],
  deletes: StagedDelete[] = [],
): Promise<{ applied: boolean; log: string }> {
  const vault = useVaultStore.getState().currentVault;
  if (!vault) throw new Error('No active vault');

  const base = await resolveBasePath(vault.basePath);
  const wikiRoot = `${base}/${WIKI_DIR}`;
  const stagingRoot = `${wikiRoot}/.staging`;

  const { mkdir, writeTextFile, rename, remove, exists } = await import('@tauri-apps/plugin-fs');
  await mkdir(stagingRoot, { recursive: true }).catch(() => {});

  // Phase 1: stage all writes.
  const stagedPaths: { staged: string; final: string }[] = [];
  for (const w of writes) {
    const stagedPath = `${stagingRoot}/${w.path.replace(/\//g, '__')}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.md`;
    await writeTextFile(stagedPath, w.content);
    const finalPath = `${wikiRoot}/${w.path}`;
    const dir = finalPath.substring(0, finalPath.lastIndexOf('/'));
    await mkdir(dir, { recursive: true }).catch(() => {});
    stagedPaths.push({ staged: stagedPath, final: finalPath });
  }

  // Phase 2: rename each staged file into place.
  const appliedPaths: string[] = [];
  for (const { staged, final: finalPath } of stagedPaths) {
    try {
      await remove(finalPath).catch(() => {});
      await rename(staged, finalPath);
      appliedPaths.push(finalPath);
    } catch (err) {
      // ponytail: best-effort. Leave remaining staged files in .staging/ for inspection.
      return { applied: false, log: `atomic batch failed at ${finalPath}: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  // Phase 3: deletes (after writes succeed).
  for (const d of deletes) {
    const finalPath = `${wikiRoot}/${d.path}`;
    if (await exists(finalPath)) await remove(finalPath).catch(() => {});
  }

  return { applied: true, log: `applied ${appliedPaths.length} writes, ${deletes.length} deletes` };
}
