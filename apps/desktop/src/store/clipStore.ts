import { create } from 'zustand';
import type { VaultEntry } from '@quill/vault-provider';
import { useVaultStore } from './vaultStore';
import type { StreamEvent } from '@/services/aiStreamUtils';
import {
  clipUrl as clipUrlService,
  generateClip as generateClipService,
  saveClip as saveClipService,
  type ClipMetadata,
  type ClipLanguage,
} from '@/services/clipService';
import { normalizeUrl } from '@/utils/urlUtils';
import {
  prepareBatchUrls,
  cancellableSleep,
  writeBatchSummary,
  type BatchItem,
  type BatchOptions,
  type BatchSummary,
} from './clipBatchHelpers';

export {
  prepareBatchUrls,
  cancellableSleep,
  writeBatchSummary,
} from './clipBatchHelpers';
export type { BatchItem, BatchItemStatus, BatchOptions, BatchSummary } from './clipBatchHelpers';

export interface ClipFile {
  path: string;
  name: string;
}

export interface ClipGroup {
  tag: string;
  clips: ClipFile[];
}

interface ClipState {
  clips: ClipFile[];
  clipGroups: ClipGroup[];
  allTags: string[];
  isLoading: boolean;
  isClipping: boolean;
  error: string | null;

  /** Pending clip metadata awaiting user confirmation */
  pendingClip: ClipMetadata | null;
  /** Progress message during clipping */
  clipProgress: string;
  /** Real-time AI streaming text (in-memory only, not persisted) */
  aiStreamText: string;
  /** Structured AI streaming events for UI rendering (in-memory only) */
  aiStreamEvents: StreamEvent[];
  /** Map of clipped URLs to their file paths (url → clipPath) */
  clipUrls: Map<string, string>;

  /** Batch clip run state */
  batchItems: BatchItem[];
  isBatchRunning: boolean;
  /** Path of the most recent batch summary file (null if none / cleared) */
  batchSummaryPath: string | null;

  loadClips: () => Promise<void>;
  /** Backward-compatible one-shot clip (used by /clip command and WebViewer) */
  clipUrl: (
    url: string,
    onProgress?: (msg: string) => void,
    lang?: ClipLanguage,
    options?: { force?: boolean },
  ) => Promise<string>;

  /** Phase 1: Fetch + AI generate metadata (no save) */
  startClip: (url: string, lang?: ClipLanguage) => Promise<void>;
  /** Phase 2: Save with potentially user-modified metadata, optionally overwriting an existing clip */
  confirmClip: (metadata: ClipMetadata, overwritePath?: string) => Promise<string>;
  /** Cancel the pending clip */
  cancelClip: () => void;
  /** Find an existing clip path by URL, or null if not found */
  findClipByUrl: (url: string) => string | null;
  /** Remove a tag from a clip. If no tags remain, delete the file. */
  removeTagFromClip: (clipPath: string, tag: string) => Promise<void>;

  /** Run a sequential batch clip over a list of URLs. Resolves with a summary. */
  clipBatch: (urls: string[], options?: BatchOptions) => Promise<BatchSummary>;
  /** Cancel the currently-running batch (after the current clip finishes). */
  cancelBatch: () => void;
  /** Clear batch state (items + summary path). */
  clearBatch: () => void;
}

/** Recursively collect all .md file entries from a nested VaultEntry tree */
function flattenMdFiles(entries: VaultEntry[]): ClipFile[] {
  const result: ClipFile[] = [];
  for (const entry of entries) {
    if (entry.type === 'file' && entry.name.endsWith('.md')) {
      result.push({ path: entry.path, name: entry.name });
    }
    if (entry.type === 'dir' && entry.children) {
      result.push(...flattenMdFiles(entry.children));
    }
  }
  return result;
}

/** Parse frontmatter tags from a clip file content (lightweight, no full parse) */
function parseTagsFromContent(content: string): string[] {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return [];
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    if (key !== 'tags') continue;
    let value = line.slice(idx + 1).trim();
    if (value.startsWith('[') && value.endsWith(']')) {
      const inner = value.slice(1, -1).trim();
      if (inner) {
        return inner.split(',').map((t) =>
          t.trim().replace(/^["']|["']$/g, ''),
        ).filter(Boolean);
      }
    }
  }
  return [];
}

/** Parse the url field from clip frontmatter (lightweight, no full parse) */
function parseUrlFromContent(content: string): string | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    if (key !== 'url') continue;
    let value = line.slice(idx + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    return value || null;
  }
  return null;
}

/** Build tag groups from a flat clip list by reading frontmatter */
async function buildClipGroups(clips: ClipFile[]): Promise<{ groups: ClipGroup[]; allTags: string[]; urlMap: Map<string, string> }> {
  const vault = useVaultStore.getState();
  const tagMap = new Map<string, ClipFile[]>();
  const tagSet = new Set<string>();
  const urlMap = new Map<string, string>();

  for (const clip of clips) {
    // Determine tag from directory structure first
    // clips/<tag>/file.md → tag is the first segment after clips/
    const segments = clip.path.split('/');
    let dirTag: string | null = null;
    if (segments.length >= 3 && segments[0] === '__clips__') {
      dirTag = segments[1];
    }

    let tags: string[] = [];
    if (dirTag && dirTag !== '未分类') {
      // Use directory tag as primary, also read frontmatter for additional tags
      try {
        const content = await vault.readFile(clip.path);
        tags = parseTagsFromContent(content);
        const clipUrl = parseUrlFromContent(content);
        if (clipUrl) urlMap.set(normalizeUrl(clipUrl), clip.path);
      } catch {
        tags = [dirTag];
      }
      // Ensure directory tag is included
      if (!tags.includes(dirTag)) {
        tags = [dirTag, ...tags];
      }
    } else {
      // No tag subdirectory (legacy flat file) — read frontmatter tags
      try {
        const content = await vault.readFile(clip.path);
        tags = parseTagsFromContent(content);
        const clipUrl = parseUrlFromContent(content);
        if (clipUrl) urlMap.set(normalizeUrl(clipUrl), clip.path);
      } catch {
        tags = [];
      }
    }

    if (tags.length === 0) {
      tags = ['未分类'];
    }

    for (const tag of tags) {
      tagSet.add(tag);
      if (!tagMap.has(tag)) tagMap.set(tag, []);
      tagMap.get(tag)!.push(clip);
    }
  }

  // Sort tags alphabetically, with "未分类" always at the end
  const sortedTags = Array.from(tagSet).sort((a, b) => {
    if (a === '未分类') return 1;
    if (b === '未分类') return -1;
    return a.localeCompare(b, 'zh');
  });

  const groups: ClipGroup[] = sortedTags.map((tag) => ({
    tag,
    clips: (tagMap.get(tag) || []).sort((a, b) => b.name.localeCompare(a.name)),
  }));

  return { groups, allTags: sortedTags, urlMap };
}

// Module-level cancel flag for the batch loop. Not reactive state — it's a
// plain mutable boolean checked between iterations. `cancelBatch` sets it;
// the loop clears it on entry and checks it after each clip + after sleeps.
let batchCancelRequested = false;

export const useClipStore = create<ClipState>((set, get) => ({
  clips: [],
  clipGroups: [],
  allTags: [],
  isLoading: false,
  isClipping: false,
  error: null,
  pendingClip: null,
  clipProgress: '',
  aiStreamText: '',
  aiStreamEvents: [],
  clipUrls: new Map(),
  batchItems: [],
  isBatchRunning: false,
  batchSummaryPath: null,

  loadClips: async () => {
    if (get().isLoading) return;
    set({ isLoading: true, error: null });
    try {
      const manager = useVaultStore.getState().manager;
      const entries = await manager.listFiles('__clips__', true, false).catch(() => []);
      const clips = flattenMdFiles(entries).sort((a, b) => b.name.localeCompare(a.name));
      set({ clips });

      // Build tag groups
      const { groups, allTags, urlMap } = await buildClipGroups(clips);
      set({ clipGroups: groups, allTags, clipUrls: urlMap });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      set({ isLoading: false });
    }
  },

  clipUrl: async (url, onProgress, lang, options) => {
    if (get().isClipping) throw new Error('剪藏任务正在进行中');
    set({ isClipping: true, error: null, aiStreamText: '', aiStreamEvents: [] });
    try {
      // Force mode: resolve the existing clip path and overwrite it.
      // Non-force mode is the caller's responsibility (e.g. AiPanel/WebViewer
      // check findClipByUrl before calling); here we only handle overwrite.
      let overwritePath: string | undefined;
      if (options?.force) {
        await get().loadClips();
        overwritePath = get().findClipByUrl(url) ?? undefined;
      }
      const filePath = await clipUrlService(url, onProgress, lang, (chunk) => {
        set((s) => ({ aiStreamText: s.aiStreamText + chunk }));
      }, (event) => {
        set((s) => ({ aiStreamEvents: [...s.aiStreamEvents, event] }));
      }, overwritePath);
      await get().loadClips();
      return filePath;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ error: msg });
      throw new Error(msg);
    } finally {
      set({ isClipping: false, aiStreamText: '', aiStreamEvents: [] });
    }
  },

  startClip: async (url: string, lang?: ClipLanguage) => {
    if (get().isClipping) throw new Error('剪藏任务正在进行中');
    set({ isClipping: true, error: null, pendingClip: null, clipProgress: '', aiStreamText: '', aiStreamEvents: [] });
    try {
      const metadata = await generateClipService(url, (msg) => {
        set({ clipProgress: msg });
      }, lang, (chunk) => {
        set((s) => ({ aiStreamText: s.aiStreamText + chunk }));
      }, (event) => {
        set((s) => ({ aiStreamEvents: [...s.aiStreamEvents, event] }));
      });
      set({ pendingClip: metadata, clipProgress: '', aiStreamText: '', aiStreamEvents: [] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ error: msg });
      throw new Error(msg);
    } finally {
      set({ isClipping: false });
    }
  },

  confirmClip: async (metadata: ClipMetadata, overwritePath?: string) => {
    set({ isClipping: true, error: null, clipProgress: '正在保存文件...' });
    try {
      const filePath = await saveClipService(metadata, overwritePath);
      set({ pendingClip: null, clipProgress: '' });
      await get().loadClips();
      return filePath;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ error: msg });
      throw new Error(msg);
    } finally {
      set({ isClipping: false });
    }
  },

  cancelClip: () => {
    set({ pendingClip: null, clipProgress: '', aiStreamText: '', aiStreamEvents: [], error: null });
  },

  findClipByUrl: (url: string) => {
    return get().clipUrls.get(normalizeUrl(url)) ?? null;
  },

  removeTagFromClip: async (clipPath: string, tagToRemove: string) => {
    const vault = useVaultStore.getState();
    let content: string;
    try {
      content = await vault.readFile(clipPath);
    } catch (err) {
      throw new Error(`读取剪藏文件失败: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Parse frontmatter tags
    const tags = parseTagsFromContent(content);
    const newTags = tags.filter((t) => t !== tagToRemove).filter(Boolean);

    if (newTags.length === 0) {
      // No tags remain — delete the file entirely
      try {
        await vault.deleteFile(clipPath);
        await vault.refreshFileTree();
      } catch (err) {
        throw new Error(`删除剪藏文件失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      // Update frontmatter tags in file content
      const newTagsLine = newTags.map((t) => `"${t}"`).join(', ');

      let newContent = content;
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (fmMatch) {
        const fmLines = fmMatch[1].split('\n');
        for (let i = 0; i < fmLines.length; i++) {
          const idx = fmLines[i].indexOf(':');
          if (idx < 0) continue;
          const key = fmLines[i].slice(0, idx).trim();
          if (key === 'tags') {
            fmLines[i] = `tags: [${newTagsLine}]`;
            break;
          }
        }
        const newFm = fmLines.join('\n');
        newContent = content.replace(/^---\n[\s\S]*?\n---/, `---\n${newFm}\n---`);
      }

      // Determine if we need to move the file (primary tag = directory changed)
      const newPrimaryTag = newTags[0];
      const segments = clipPath.split('/');
      const oldDirTag = segments.length >= 3 && segments[0] === '__clips__' ? segments[1] : null;

      // Write updated content first
      await vault.writeFile(clipPath, newContent);

      // Move file if primary tag directory changed
      if (oldDirTag && newPrimaryTag !== oldDirTag) {
        const fileName = segments[segments.length - 1];
        const newDir = `__clips__/${newPrimaryTag}`;
        const newPath = `${newDir}/${fileName}`;

        await vault.createDir(newDir);
        await vault.renameFile(clipPath, newPath);

        // Clean up empty old directory
        const oldDir = `__clips__/${oldDirTag}`;
        try {
          await vault.deleteDir(oldDir);
        } catch {
          // Directory not empty — other clips still use it
        }
      }

      await vault.refreshFileTree();
    }

    await get().loadClips();
  },

  clipBatch: async (urls, options) => {
    if (get().isBatchRunning) {
      throw new Error('批量剪藏正在进行中');
    }

    const force = !!options?.force;
    const delayMs = Math.max(0, options?.delayMs ?? 0);

    // 1. Normalize + dedupe + validate the input list (pure helper).
    const items = prepareBatchUrls(urls);
    batchCancelRequested = false;
    set({ batchItems: items, isBatchRunning: true, batchSummaryPath: null, error: null });

    // Helper to update a single item's status in-place.
    const updateItem = (index: number, patch: Partial<BatchItem>) => {
      set((s) => {
        const next = s.batchItems.slice();
        const current = next[index];
        if (current) next[index] = { ...current, ...patch };
        return { batchItems: next };
      });
    };

    // 2. Ensure clipUrls is populated so findClipByUrl works for the whole batch.
    try {
      await get().loadClips();
    } catch {
      // Non-fatal: dedupe against existing clips just won't fire; the loop
      // still runs (and creates new files).
    }

    let doneCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    // 3. Sequential loop over pending items.
    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      // Items already resolved during prepareBatchUrls (invalid / dup) stay as-is.
      if (item.status !== 'pending') {
        if (item.status === 'skipped') skippedCount++;
        else if (item.status === 'failed') failedCount++;
        continue;
      }

      // Cancellation check between iterations: finish the current clip but
      // don't start the next one. Remaining pending items → cancelled.
      if (batchCancelRequested) {
        updateItem(i, { status: 'cancelled', reason: '已取消' });
        // Mark all subsequent pending items as cancelled too.
        for (let j = i + 1; j < items.length; j++) {
          if (items[j].status === 'pending') {
            updateItem(j, { status: 'cancelled', reason: '已取消' });
          }
        }
        break;
      }

      updateItem(i, { status: 'running' });

      try {
        // Duplicate check against existing clips (unless force is on).
        if (!force) {
          const existingPath = get().findClipByUrl(item.url);
          if (existingPath) {
            updateItem(i, { status: 'skipped', reason: '已存在', clipPath: existingPath });
            skippedCount++;
            continue;
          }
        }

        // Run the two-phase clip without auto-opening the editor.
        const metadata = await generateClipService(item.url, (msg) => {
          updateItem(i, { reason: msg });
        });
        const overwritePath = force
          ? (get().findClipByUrl(item.url) ?? undefined)
          : undefined;
        const clipPath = await saveClipService(metadata, overwritePath, { skipAutoOpen: true });

        updateItem(i, { status: 'done', clipPath, reason: undefined });
        doneCount++;
      } catch (err) {
        // Fail-soft: record the error and continue with the next URL.
        const msg = err instanceof Error ? err.message : String(err);
        updateItem(i, { status: 'failed', error: msg });
        failedCount++;
      }

      // Inter-URL delay (cancellation-aware). Checked again after the sleep
      // so a cancel issued during the delay stops before the next clip.
      if (delayMs > 0 && i < items.length - 1) {
        try {
          await cancellableSleep(delayMs, () => batchCancelRequested);
        } catch {
          // Cancelled during sleep — the loop-top check on the next iteration
          // will mark remaining items as cancelled.
        }
      }
    }

    // 4. Write the summary file.
    let summaryPath: string | undefined;
    try {
      summaryPath = await writeBatchSummary(get().batchItems);
    } catch (err) {
      // Summary write failure is non-fatal; the run itself already succeeded.
      set({ error: `批量汇总写入失败: ${err instanceof Error ? err.message : String(err)}` });
    }

    set({ isBatchRunning: false, batchSummaryPath: summaryPath ?? null });

    return {
      total: items.length,
      done: doneCount,
      skipped: skippedCount,
      failed: failedCount,
      summaryPath,
    };
  },

  cancelBatch: () => {
    batchCancelRequested = true;
  },

  clearBatch: () => {
    set({ batchItems: [], batchSummaryPath: null });
  },
}));
