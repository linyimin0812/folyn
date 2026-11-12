import { create } from 'zustand';
import { useEditorStore } from '@/store/editorStore';
import { useVaultStore } from '@/store/vaultStore';
import { openFile } from '@/services/editorIoService';

/** One stop in the document-link trail. */
export interface DocLinkEntry {
  path: string;
  name: string;
}

interface DocLinkHistoryState {
  back: DocLinkEntry[];
  forward: DocLinkEntry[];
  /** Follow a document link: remember where we came from, drop the forward trail. */
  follow: (target: DocLinkEntry) => void;
  goBack: () => void;
  goForward: () => void;
}

/** The active file tab, i.e. where a jump leaves from. Web tabs aren't documents. */
function currentEntry(): DocLinkEntry | null {
  const { tabs, activeTabId } = useEditorStore.getState();
  const tab = tabs.find((t) => t.id === activeTabId);
  return tab && tab.fileType !== 'web' ? { path: tab.path, name: tab.name } : null;
}

function open(entry: DocLinkEntry): void {
  void openFile(entry.path, entry.name);
}

const LIMIT = 50;

/**
 * Back/forward trail for document links followed in the markdown preview,
 * like a browser's history. Only link jumps are recorded; opening files from
 * the tree or tabs doesn't touch it. Revisiting a closed tab reopens it.
 */
export const useDocLinkHistory = create<DocLinkHistoryState>((set, get) => ({
  back: [],
  forward: [],
  follow: (target) => {
    const from = currentEntry();
    if (from && from.path !== target.path) {
      set((s) => ({ back: [...s.back, from].slice(-LIMIT), forward: [] }));
    }
    open(target);
  },
  goBack: () => {
    const { back } = get();
    const prev = back[back.length - 1];
    if (!prev) return;
    const from = currentEntry();
    set((s) => ({ back: s.back.slice(0, -1), forward: from ? [...s.forward, from] : s.forward }));
    open(prev);
  },
  goForward: () => {
    const { forward } = get();
    const next = forward[forward.length - 1];
    if (!next) return;
    const from = currentEntry();
    set((s) => ({ forward: s.forward.slice(0, -1), back: from ? [...s.back, from] : s.back }));
    open(next);
  },
}));

// Vault-relative paths mean nothing in another vault: start a fresh trail.
useVaultStore.subscribe((state, prev) => {
  if (state.activeVaultId !== prev.activeVaultId) useDocLinkHistory.setState({ back: [], forward: [] });
});
