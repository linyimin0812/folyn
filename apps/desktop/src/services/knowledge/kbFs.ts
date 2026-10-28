/**
 * 知识库 FS 端口 + 原子写 + SHA-256 + JSON 读写。
 *
 * 模式沿用 versionHistoryService：纯逻辑接收注入的 `KbFs` 端口（可测试），
 * `vaultKbFs()` 是接 vaultStore.manager 的真实适配器。原子写 = `.tmp` + rename，
 * 崩溃后目标文件要么旧要么新，不出现半截 JSON。
 */

import { useVaultStore } from '@/store/vaultStore';
import {
  kbManifestPath,
  kbReviewsPath,
  kbDeletionsPath,
  kbNavigationPath,
  kbSourceIndexPath,
  kbTopicRefsPath,
} from './kbPaths';
import type {
  KbManifest,
  KbNavigation,
  KbRef,
  KbReviewItem,
  KbDeletionIntent,
  KbSourceIndex,
} from './kbTypes';

export interface KbFs {
  /** Generated paths are absolute within the Vault, while source paths remain unchanged. */
  root?: string;
  listSourceTree?: () => Promise<{ path: string; type: 'file' | 'dir' }[]>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  rename(oldPath: string, newPath: string): Promise<void>;
}

/** `.tmp` + rename 原子写。writeFile 自带父目录创建（tauriProvider）。 */
export async function kbWriteAtomic(fs: KbFs, path: string, content: string): Promise<void> {
  const tmp = `${path}.tmp`;
  await fs.writeFile(tmp, content);
  await fs.rename(tmp, path);
}

export async function sha256Hex(content: string): Promise<string> {
  const data = new TextEncoder().encode(content);
  const buf = await crypto.subtle.digest('SHA-256', data);
  let hex = '';
  for (const b of new Uint8Array(buf)) hex += b.toString(16).padStart(2, '0');
  return hex;
}

/** 读 JSON；不存在返回 null；损坏返回 null 并 console.warn。 */
async function readJson<T>(fs: KbFs, path: string, what: string): Promise<T | null> {
  if (!(await fs.exists(path))) return null;
  try {
    return JSON.parse(await fs.readFile(path)) as T;
  } catch (err) {
    console.warn(`[kb] ${what} 损坏，按不存在处理: ${path}`, err);
    return null;
  }
}

export async function readManifest(fs: KbFs): Promise<KbManifest | null> {
  return readJson<KbManifest>(fs, kbManifestPath(fs.root), 'manifest.json');
}

export async function writeManifest(fs: KbFs, manifest: KbManifest): Promise<void> {
  await kbWriteAtomic(fs, kbManifestPath(fs.root), JSON.stringify(manifest, null, 2));
}

export async function readSourceIndex(fs: KbFs, srcId: string): Promise<KbSourceIndex | null> {
  return readJson<KbSourceIndex>(fs, kbSourceIndexPath(srcId, fs.root), `source index ${srcId}`);
}

export async function writeSourceIndex(fs: KbFs, index: KbSourceIndex): Promise<void> {
  await kbWriteAtomic(fs, kbSourceIndexPath(index.srcId, fs.root), JSON.stringify(index, null, 2));
}

export async function readTopicRefs(fs: KbFs, tpId: string): Promise<KbRef[]> {
  return (await readJson<KbRef[]>(fs, kbTopicRefsPath(tpId, fs.root), `refs ${tpId}`)) ?? [];
}

export async function writeTopicRefs(fs: KbFs, tpId: string, refs: KbRef[]): Promise<void> {
  await kbWriteAtomic(fs, kbTopicRefsPath(tpId, fs.root), JSON.stringify(refs, null, 2));
}

export async function readNavigation(fs: KbFs): Promise<KbNavigation> {
  return (await readJson<KbNavigation>(fs, kbNavigationPath(fs.root), 'navigation.json')) ?? { topics: [] };
}

export async function writeNavigation(fs: KbFs, nav: KbNavigation): Promise<void> {
  await kbWriteAtomic(fs, kbNavigationPath(fs.root), JSON.stringify(nav, null, 2));
}

export async function readReviews(fs: KbFs): Promise<KbReviewItem[]> {
  return (await readJson<KbReviewItem[]>(fs, kbReviewsPath(fs.root), 'reviews.json')) ?? [];
}

export async function appendReviews(fs: KbFs, items: KbReviewItem[]): Promise<void> {
  const existing = await readReviews(fs);
  await kbWriteAtomic(fs, kbReviewsPath(fs.root), JSON.stringify([...existing, ...items], null, 2));
}

/** 切片 A 只保证 deletions.json 落盘占位（schema 就绪，逻辑在切片 C）。 */
export async function ensureDeletionsPlaceholder(fs: KbFs): Promise<void> {
  const p = kbDeletionsPath(fs.root);
  if (!(await fs.exists(p))) {
    await kbWriteAtomic(fs, p, JSON.stringify([] satisfies KbDeletionIntent[], null, 2));
  }
}

/** 真实适配器：vaultStore.manager（vault 相对路径）。exists 用读探测 —— manager 无 exists。 */
export function vaultKbFs(expectedVaultId = useVaultStore.getState().activeVaultId): KbFs {
  const manager = useVaultStore.getState().manager;
  const guard = () => {
    const vault = useVaultStore.getState();
    if (!expectedVaultId || vault.activeVaultId !== expectedVaultId || vault.isLoading) throw new Error('Vault 已切换，已停止当前知识操作。');
  };
  return {
    listSourceTree: async () => {
      guard();
      const entries = await manager.listFiles('', true, true, ['__kb__', '.git', 'node_modules']);
      guard();
      const result: { path: string; type: 'file' | 'dir' }[] = [];
      const walk = (items: typeof entries) => { for (const entry of items) { result.push({ path: entry.path, type: entry.type }); if (entry.type === 'dir' && entry.children) walk(entry.children); } };
      walk(entries); return result;
    },
    readFile: (p) => { guard(); return manager.readFile(p); },
    writeFile: (p, c) => { guard(); return manager.writeFile(p, c); },
    exists: async (p) => { guard(); try { await manager.readFile(p); guard(); return true; } catch (error) { guard(); return false; } },
    rename: (o, n) => { guard(); return manager.rename(o, n); },
  };
}
