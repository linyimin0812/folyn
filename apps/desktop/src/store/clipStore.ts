import { create } from 'zustand';
import type { VaultEntry } from '@quill/vault-provider';
import { useVaultStore } from './vaultStore';
import {
  clipUrl as clipUrlService,
  generateClip as generateClipService,
  saveClip as saveClipService,
  type ClipMetadata,
  type ClipLanguage,
} from '@/services/clipService';

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
  /** Map of clipped URLs to their file paths (url → clipPath) */
  clipUrls: Map<string, string>;

  loadClips: () => Promise<void>;
  /** Backward-compatible one-shot clip (used by /clip command and WebViewer) */
  clipUrl: (url: string, onProgress?: (msg: string) => void, lang?: ClipLanguage) => Promise<string>;

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
    if (segments.length >= 3 && segments[0] === 'clips') {
      dirTag = segments[1];
    }

    let tags: string[] = [];
    if (dirTag && dirTag !== '未分类') {
      // Use directory tag as primary, also read frontmatter for additional tags
      try {
        const content = await vault.readFile(clip.path);
        tags = parseTagsFromContent(content);
        const clipUrl = parseUrlFromContent(content);
        if (clipUrl) urlMap.set(clipUrl, clip.path);
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
        if (clipUrl) urlMap.set(clipUrl, clip.path);
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

export const useClipStore = create<ClipState>((set, get) => ({
  clips: [],
  clipGroups: [],
  allTags: [],
  isLoading: false,
  isClipping: false,
  error: null,
  pendingClip: null,
  clipProgress: '',
  clipUrls: new Map(),

  loadClips: async () => {
    if (get().isLoading) return;
    set({ isLoading: true, error: null });
    try {
      const manager = useVaultStore.getState().manager;
      const entries = await manager.listFiles('clips', true, false).catch(() => []);
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

  clipUrl: async (url: string, onProgress?: (msg: string) => void, lang?: ClipLanguage) => {
    if (get().isClipping) throw new Error('剪藏任务正在进行中');
    set({ isClipping: true, error: null });
    try {
      const filePath = await clipUrlService(url, onProgress, lang);
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

  startClip: async (url: string, lang?: ClipLanguage) => {
    if (get().isClipping) throw new Error('剪藏任务正在进行中');
    set({ isClipping: true, error: null, pendingClip: null, clipProgress: '' });
    try {
      const metadata = await generateClipService(url, (msg) => {
        set({ clipProgress: msg });
      }, lang);
      set({ pendingClip: metadata, clipProgress: '' });
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
    set({ pendingClip: null, clipProgress: '', error: null });
  },

  findClipByUrl: (url: string) => {
    return get().clipUrls.get(url) ?? null;
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
      const oldDirTag = segments.length >= 3 && segments[0] === 'clips' ? segments[1] : null;

      // Write updated content first
      await vault.writeFile(clipPath, newContent);

      // Move file if primary tag directory changed
      if (oldDirTag && newPrimaryTag !== oldDirTag) {
        const fileName = segments[segments.length - 1];
        const newDir = `clips/${newPrimaryTag}`;
        const newPath = `${newDir}/${fileName}`;

        await vault.createDir(newDir);
        await vault.renameFile(clipPath, newPath);

        // Clean up empty old directory
        const oldDir = `clips/${oldDirTag}`;
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
}));
