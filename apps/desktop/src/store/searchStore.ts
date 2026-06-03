import { create } from 'zustand';
import { useVaultStore } from './vaultStore';
import type { VaultEntry } from '@quill/vault-provider';

export interface SearchResult {
  filePath: string;
  fileName: string;
  lineNumber: number;
  lineContent: string;
  matchStart: number;
  matchEnd: number;
}

interface SearchState {
  /** Whether the search panel is open */
  isOpen: boolean;
  /** The current search query */
  query: string;
  /** Whether the search is case-sensitive */
  caseSensitive: boolean;
  /** Whether to use regex matching */
  useRegex: boolean;
  /** Search results grouped by file */
  results: SearchResult[];
  /** Whether a search is currently in progress */
  isSearching: boolean;
  /** Cache of file contents to avoid re-reading */
  fileContentCache: Map<string, string>;

  // Actions
  openPanel: () => void;
  closePanel: () => void;
  setQuery: (query: string) => void;
  toggleCaseSensitive: () => void;
  toggleUseRegex: () => void;
  performSearch: () => Promise<void>;
  clearResults: () => void;
  clearCache: () => void;
}

/** Recursively flatten a VaultEntry tree to get all .md file paths */
function flattenMarkdownFiles(entries: VaultEntry[]): { path: string; name: string }[] {
  const files: { path: string; name: string }[] = [];
  for (const entry of entries) {
    if (entry.type === 'file' && entry.name.endsWith('.md')) {
      files.push({ path: entry.path, name: entry.name });
    } else if (entry.type === 'dir' && entry.children) {
      files.push(...flattenMarkdownFiles(entry.children));
    }
  }
  return files;
}

export const useSearchStore = create<SearchState>()((set, get) => ({
  isOpen: false,
  query: '',
  caseSensitive: false,
  useRegex: false,
  results: [],
  isSearching: false,
  fileContentCache: new Map(),

  openPanel: () => set({ isOpen: true }),
  closePanel: () => set({ isOpen: false, results: [], query: '' }),

  setQuery: (query) => set({ query }),

  toggleCaseSensitive: () => {
    set((state) => ({ caseSensitive: !state.caseSensitive }));
  },

  toggleUseRegex: () => {
    set((state) => ({ useRegex: !state.useRegex }));
  },

  performSearch: async () => {
    const { query, caseSensitive, useRegex, fileContentCache } = get();
    if (!query.trim()) {
      set({ results: [], isSearching: false });
      return;
    }

    set({ isSearching: true });

    try {
      const { fileTree, readFile } = useVaultStore.getState();
      const mdFiles = flattenMarkdownFiles(fileTree);
      const results: SearchResult[] = [];

      // Build the search pattern
      let regex: RegExp;
      try {
        if (useRegex) {
          regex = new RegExp(query, caseSensitive ? 'g' : 'gi');
        } else {
          const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          regex = new RegExp(escaped, caseSensitive ? 'g' : 'gi');
        }
      } catch {
        // Invalid regex, abort search
        set({ results: [], isSearching: false });
        return;
      }

      for (const file of mdFiles) {
        let content: string;
        if (fileContentCache.has(file.path)) {
          content = fileContentCache.get(file.path)!;
        } else {
          try {
            content = await readFile(file.path);
            fileContentCache.set(file.path, content);
          } catch {
            continue;
          }
        }

        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          regex.lastIndex = 0;
          const match = regex.exec(line);
          if (match) {
            results.push({
              filePath: file.path,
              fileName: file.name,
              lineNumber: i + 1,
              lineContent: line,
              matchStart: match.index,
              matchEnd: match.index + match[0].length,
            });
          }
        }
      }

      set({ results, isSearching: false });
    } catch {
      set({ results: [], isSearching: false });
    }
  },

  clearResults: () => set({ results: [] }),
  clearCache: () => {
    get().fileContentCache.clear();
    set({});
  },
}));
