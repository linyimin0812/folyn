/**
 * 知识库 FS 端口 + 原子写 + SHA-256 + JSON 读写。
 *
 * 模式沿用 versionHistoryService：纯逻辑接收注入的 `KbFs` 端口（可测试），
 * `vaultKbFs()` 是真实适配器。原子写 = `.tmp` + rename，
 * 崩溃后目标文件要么旧要么新，不出现半截 JSON。
 *
 * 双路由（ADR-0011）：KB 生成物（`__kb__/...` 逻辑路径）存
 * `~/.folyn/vaults/<vaultId>/__kb__/`，解析为绝对路径直写 tauri fs（KbGenStore）；
 * 源资料（用户自己的文件）仍在 vault 内，vault 相对路径走 vaultStore.manager。
 */

import { homeDir, join } from '@tauri-apps/api/path';
import { exists as tauriExists, mkdir, readTextFile, rename as tauriRename, writeTextFile } from '@tauri-apps/plugin-fs';
import { useVaultStore } from '@/store/vaultStore';
import {
  isKbPath,
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
  /**
   * KB 生成物 → 绝对磁盘路径（编辑器打开快照/主题页用，外部路径先例 drops）；
   * 源资料（vault 相对）→ null，仍按 vault 路径打开。测试 fake 可不实现。
   */
  absPath?: (path: string) => Promise<string | null>;
}

// ── KB 生成物存储（ADR-0011：~/.folyn/vaults/<vaultId>/__kb__/）─────────────────

/**
 * 生成物后端端口：接收已解析的绝对路径。真实实现走 tauri fs；
 * base（`~/.folyn/vaults/<vaultId>`）解析是异步的，模块级缓存 homeDir
 * （versionHistory.ts 同款 —— homeDir 是会话级常量）。
 */
export interface KbGenStore {
  resolveBase(vaultId: string): Promise<string>;
  readFile(absPath: string): Promise<string>;
  writeFile(absPath: string, content: string): Promise<void>;
  exists(absPath: string): Promise<boolean>;
  rename(oldAbsPath: string, newAbsPath: string): Promise<void>;
}

// ponytail: 模块级缓存 homeDir，versionHistory versionsBase 同款（会话级常量）。
let folynVaultsBase = '';

function parentDir(p: string): string {
  const i = p.lastIndexOf('/');
  if (i < 0) return p;
  return i === 0 ? '/' : p.slice(0, i);
}

const tauriKbGenStore: KbGenStore = {
  // ponytail: base 不含 __kb__ —— 逻辑路径本身带 `__kb__/` 前缀，拼接即得新根。
  resolveBase: (vaultId) => resolveVaultsBase().then((base) => join(base, vaultId)),
  readFile: (abs) => readTextFile(abs),
  writeFile: async (abs, content) => {
    await mkdir(parentDir(abs), { recursive: true });
    await writeTextFile(abs, content);
  },
  exists: (abs) => tauriExists(abs),
  rename: (o, n) => tauriRename(o, n),
};

async function resolveVaultsBase(): Promise<string> {
  if (!folynVaultsBase) {
    const home = (await homeDir()).replace(/\/+$/, '');
    folynVaultsBase = await join(home, '.folyn', 'vaults');
  }
  return folynVaultsBase;
}

let genStore: KbGenStore = tauriKbGenStore;

/** 测试注入：替换生成物存储。传 null 恢复默认 tauri 实现。勿在产品代码调用。 */
export function setKbGenStoreForTests(store: KbGenStore | null): void {
  genStore = store ?? tauriKbGenStore;
}

/** `.tmp` + rename 原子写。父目录创建：manager（tauriProvider）与 KbGenStore.writeFile 均自带。 */
export async function kbWriteAtomic(fs: KbFs, path: string, content: string): Promise<void> {
  const tmp = `${path}.tmp`;
  await fs.writeFile(tmp, content);
  await fs.rename(tmp, path);
}

// ── 写入串行队列（并行构建正确性关键）──────────────────────────────────────────
// kbWriteAtomic 用固定 `.tmp` 名：并行写同一文件（manifest/navigation/reviews/
// refs）会撞 tmp；appendReviews / topicSynth.applyProposal 这类「读-改-写」并发
// 会丢更新。构建期所有跨文件读-改-写整段经此互斥（promise 链）；共享 manifest/
// nav 对象的内存修改保持「同步段内修改」模式不变（写回时 JSON.stringify 取到的
// 总是已含全部同步修改的快照）。非构建路径（saveConfig / 审阅 / 核验 / 页内编辑）
// 已由 knowledgeStore 的 mutationRunning 与 buildRunning 互斥，不必入队。
// ponytail: 全局单队列（锁粒度粗），构建写入量小；如成瓶颈再按文件分锁。
let kbWriteChain: Promise<unknown> = Promise.resolve();
export function kbWriteQueue<T>(section: () => Promise<T>): Promise<T> {
  const run = kbWriteChain.then(section, section);
  kbWriteChain = run.then(() => undefined, () => undefined);
  return run;
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
  // 读-改-写整段入串行队列：并行合成（多份资料同时降级进审阅）下不丢更新。
  await kbWriteQueue(async () => {
    const existing = await readReviews(fs);
    await kbWriteAtomic(fs, kbReviewsPath(fs.root), JSON.stringify([...existing, ...items], null, 2));
  });
}

/** 切片 A 只保证 deletions.json 落盘占位（schema 就绪，逻辑在切片 C）。 */
export async function ensureDeletionsPlaceholder(fs: KbFs): Promise<void> {
  const p = kbDeletionsPath(fs.root);
  if (!(await fs.exists(p))) {
    await kbWriteAtomic(fs, p, JSON.stringify([] satisfies KbDeletionIntent[], null, 2));
  }
}

/**
 * 真实适配器（双路由，ADR-0011）：
 * - `__kb__/...` 生成物 → `~/.folyn/vaults/<vaultId>/` 下的绝对路径，走 KbGenStore（tauri fs）；
 * - 其余（源资料，vault 相对）→ vaultStore.manager。
 * 两条路由共用同一 vault 切换 guard。manager 无 exists —— 源资料路径用读探测。
 */
export function vaultKbFs(expectedVaultId = useVaultStore.getState().activeVaultId): KbFs {
  const manager = useVaultStore.getState().manager;
  const guard = () => {
    const vault = useVaultStore.getState();
    if (!expectedVaultId || vault.activeVaultId !== expectedVaultId || vault.isLoading) throw new Error('Vault 已切换，已停止当前知识操作。');
  };
  const genAbs = async (p: string): Promise<string> => {
    if (!expectedVaultId) throw new Error('Vault 已切换，已停止当前知识操作。');
    return `${await genStore.resolveBase(expectedVaultId)}/${p}`;
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
    absPath: (p) => (isKbPath(p) ? genAbs(p) : Promise.resolve(null)),
    // guard 保持同步抛出（原适配器语义）；生成物路由的二次 guard 在 await 后。
    readFile: (p) => {
      guard();
      if (isKbPath(p)) return genAbs(p).then((abs) => { guard(); return genStore.readFile(abs); });
      return manager.readFile(p);
    },
    writeFile: (p, c) => {
      guard();
      if (isKbPath(p)) return genAbs(p).then((abs) => { guard(); return genStore.writeFile(abs, c); });
      return manager.writeFile(p, c);
    },
    exists: async (p) => {
      guard();
      if (isKbPath(p)) { const abs = await genAbs(p); guard(); return genStore.exists(abs); }
      try { await manager.readFile(p); guard(); return true; } catch { guard(); return false; }
    },
    rename: (o, n) => {
      guard();
      // 原子写的 tmp 与目标同目录同路由；跨路由 rename 属调用方错误，显式拒绝。
      if (isKbPath(o) !== isKbPath(n)) throw new Error(`rename 不支持跨存储路由：${o} → ${n}`);
      if (isKbPath(o)) {
        return Promise.all([genAbs(o), genAbs(n)]).then(([a, b]) => { guard(); return genStore.rename(a, b); });
      }
      return manager.rename(o, n);
    },
  };
}
