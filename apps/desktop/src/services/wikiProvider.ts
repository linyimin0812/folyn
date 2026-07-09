import { useVaultStore } from '@/store/vaultStore';
import { WIKI_DIR, type WikiEntry } from '@/types/wiki';
import { resolveBasePath } from '@/utils/pathResolver';

async function getWikiRoot(): Promise<string> {
  const vault = useVaultStore.getState().currentVault;
  if (!vault) throw new Error('No active vault');
  const basePath = await resolveBasePath(vault.basePath);
  return `${basePath}/${WIKI_DIR}`;
}

export const wikiProvider = {
  async getRoot(): Promise<string> {
    return getWikiRoot();
  },

  async ensureDir(dirPath: string): Promise<void> {
    const { mkdir } = await import('@tauri-apps/plugin-fs');
    try {
      await mkdir(dirPath, { recursive: true });
    } catch {
      // directory may already exist
    }
  },

  async init(): Promise<string> {
    const root = await getWikiRoot();
    const { exists } = await import('@tauri-apps/plugin-fs');
    const rootExists = await exists(root);
    if (!rootExists) {
      await this.ensureDir(root);
      await this.ensureDir(`${root}/entities`);
      await this.ensureDir(`${root}/concepts`);
      await this.ensureDir(`${root}/sources`);
      await this.ensureDir(`${root}/syntheses`);
      await this.ensureDir(`${root}/cache`);

      await this.writeFile('schema.md', DEFAULT_SCHEMA);
      await this.writeFile('purpose.md', DEFAULT_PURPOSE);
      await this.writeFile('index.md', '# Wiki Index\n\n_No pages yet._\n');
      await this.writeFile('log.md', '# Wiki Log\n\n');
      await this.writeFile('overview.md', '# Knowledge Overview\n\n_Wiki is empty. Ingest some files to get started._\n');
    }
    return root;
  },

  async readFile(relativePath: string): Promise<string> {
    const root = await getWikiRoot();
    const { readTextFile } = await import('@tauri-apps/plugin-fs');
    return readTextFile(`${root}/${relativePath}`);
  },

  async writeFile(relativePath: string, content: string): Promise<void> {
    const root = await getWikiRoot();
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    const fullPath = `${root}/${relativePath}`;
    const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));
    await this.ensureDir(dir);
    await writeTextFile(fullPath, content);
  },

  async deleteFile(relativePath: string): Promise<void> {
    const root = await getWikiRoot();
    const { remove } = await import('@tauri-apps/plugin-fs');
    await remove(`${root}/${relativePath}`);
  },

  async exists(relativePath: string): Promise<boolean> {
    const root = await getWikiRoot();
    const { exists } = await import('@tauri-apps/plugin-fs');
    return exists(`${root}/${relativePath}`);
  },

  async listFiles(dirPath: string = ''): Promise<WikiEntry[]> {
    const root = await getWikiRoot();
    const { readDir } = await import('@tauri-apps/plugin-fs');
    const targetDir = dirPath ? `${root}/${dirPath}` : root;
    try {
      const entries = await readDir(targetDir);
      const result: WikiEntry[] = [];
      for (const entry of entries) {
        if (entry.name?.startsWith('.') || entry.name === 'cache') continue;
        const entryPath = dirPath ? `${dirPath}/${entry.name}` : entry.name ?? '';
        if (entry.isDirectory) {
          const children = await this.listFiles(entryPath);
          result.push({ path: entryPath, name: entry.name ?? '', type: 'dir', children });
        } else {
          result.push({ path: entryPath, name: entry.name ?? '', type: 'file' });
        }
      }
      return result.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    } catch {
      return [];
    }
  },

  async readHashCache(): Promise<Record<string, string>> {
    try {
      const content = await this.readFile('cache/hashes.json');
      return JSON.parse(content);
    } catch {
      return {};
    }
  },

  async writeHashCache(cache: Record<string, string>): Promise<void> {
    await this.writeFile('cache/hashes.json', JSON.stringify(cache, null, 2));
  },

  async readReviews(): Promise<import('@/types/wiki').ReviewItem[]> {
    try {
      const content = await this.readFile('cache/reviews.json');
      return JSON.parse(content);
    } catch {
      return [];
    }
  },

  async writeReviews(items: import('@/types/wiki').ReviewItem[]): Promise<void> {
    await this.writeFile('cache/reviews.json', JSON.stringify(items, null, 2));
  },
};

const DEFAULT_SCHEMA = `---
title: Wiki Schema
type: schema
---

# Wiki Schema

## Page Types
- **entity**: People, organizations, projects, technologies
- **concept**: Theories, methods, patterns, principles
- **source**: Source document summaries (one per ingested file)
- **comparison**: Side-by-side analysis
- **synthesis**: High-value query answers saved back to wiki

## Frontmatter Fields
Every wiki page must include:
- title, type, sources[], tags[], created, updated, confidence, related[]

## Naming Convention
- File names use kebab-case: \`react-hooks.md\`, \`state-management.md\`
- Directories: entities/, concepts/, sources/, syntheses/

## Wikilink Convention
- Reference other wiki pages: \`[[wiki://entities/react]]\`
- Reference vault source files: \`[[notes/tech/react-hooks]]\`

## Update Strategy
- If an entity/concept page already exists, UPDATE it (merge new information)
- If it doesn't exist, CREATE it
- Always update index.md and log.md after changes
`;

const DEFAULT_PURPOSE = `---
title: Wiki Purpose
type: purpose
---

# Knowledge Base Purpose

## Goals
_Define what this knowledge base is for._

## Key Questions
_What questions are you trying to answer?_

## Scope
_What topics does this wiki cover?_
`;
