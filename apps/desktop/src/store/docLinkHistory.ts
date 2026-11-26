import { create } from 'zustand';
import { useEditorStore } from '@/store/editorStore';
import { useVaultStore } from '@/store/vaultStore';
import { useEditorViewStateStore } from '@/store/editorViewState';
import { openFile } from '@/services/editorIoService';
import { isExternalPath } from '@/utils/isExternalPath';

/**
 * Reader navigation history (refactor spec Phase 4.4–4.6): a browser-tab-like
 * back/forward chain that follows the READING SESSION across editor tabs,
 * with the reading position (scrollTop / `#fragment`) snapshotted on every
 * entry so back/forward restore the exact spot, not just the document.
 *
 * What enters the history — and only that — is a deliberate navigation:
 * following a document link, an outline jump, an in-document anchor jump.
 * Plain scrolling, tab-bar switches, collapsible expands and focus views
 * never push entries.
 *
 * The chain is anchored on the editor tab the session is currently reading
 * (`trails[activeTabId]`), and it TRAVELS with the session:
 *
 *   - link follow a→b: the chain moves from tab a to tab b (b's back trail
 *     gains "came from a at position X"). Tab a's parked copy is gone — the
 *     session moved; a's Back button goes quiet until a new session lands
 *     there. Switching editor tabs via the tab bar does NOT move chains:
 *     each tab keeps the chain its own reading session parked there.
 *   - back on b: the chain moves to the entry's tab (a), carrying b's
 *     current position on the forward stack.
 *   - forward on a: symmetric, back to b.
 *
 * Tab ids are the deterministic ids openFile creates (`vaultId:path`, or
 * `ext:path` for external files), computed the same way so the trail lands
 * on the exact tab that will show the document.
 */
export interface DocLinkEntry {
  path: string;
  name: string;
  /** Reading position snapshot at the moment of the jump. */
  scrollTop?: number;
  /** `#fragment` of the link, when the jump targeted a heading. */
  anchorId?: string;
  /** Container state (tabs selections / open collapsibles) at the position —
   *  captured by the click site from the live preview DOM, replayed on
   *  back/forward (refactor spec Phase 4.5). Structurally compatible with
   *  headingNav's ComponentStateSnapshot. */
  components?: {
    openCollapsibles: number[];
    tabsSelections: Array<{ line: number; active: number }>;
  };
}

interface TabTrail {
  back: DocLinkEntry[];
  forward: DocLinkEntry[];
}

interface DocLinkHistoryState {
  /** One chain per tab id — the one its reading session parked there. */
  trails: Record<string, TabTrail>;
  /** Vault the trails belong to; vault-relative paths mean nothing elsewhere. */
  vaultId: string | null;
  /**
   * Follow a document link: the chain travels from the active tab to the
   * target tab, remembering where it came from. `fromScrollTop` is the
   * leaving preview's live scrollTop (captured at the click site — the
   * store's debounced per-tab value can trail the reader by 200 ms);
   * `fromComponents` is the live container-state snapshot at the click.
   */
  follow: (target: DocLinkEntry, fromScrollTop?: number, fromComponents?: DocLinkEntry['components']) => void;
  /**
   * Record a same-document navigation (outline jump, in-doc anchor): pushes
   * the current reading position so Back returns to it. No file is opened —
   * the caller performs the scroll.
   */
  pushPosition: (fromScrollTop: number, fromComponents?: DocLinkEntry['components']) => void;
  goBack: () => void;
  goForward: () => void;
}

/**
 * The active file tab, i.e. where a jump leaves from. Web tabs aren't documents.
 * `components` comes from the click site's live preview snapshot.
 */
function currentEntry(
  scrollTop?: number,
  components?: DocLinkEntry['components'],
): DocLinkEntry | null {
  const { tabs, activeTabId } = useEditorStore.getState();
  const tab = tabs.find((t) => t.id === activeTabId);
  if (!tab || tab.fileType === 'web') return null;
  const entry: DocLinkEntry = { path: tab.path, name: tab.name };
  if (scrollTop !== undefined) entry.scrollTop = scrollTop;
  if (components) entry.components = components;
  return entry;
}

/** Live scrollTop of the active tab's preview, from the persistence store. */
function savedScrollTop(): number | undefined {
  const { tabs, activeTabId } = useEditorStore.getState();
  return tabs.find((t) => t.id === activeTabId)?.previewScrollTop;
}

/** Container-state snapshot persisted for the active tab's reading scene. */
function activeTabComponents(): DocLinkEntry['components'] | undefined {
  const { tabs, activeTabId } = useEditorStore.getState();
  return tabs.find((t) => t.id === activeTabId)?.previewComponents;
}

/** The tab id openFile would use for this path (deterministic tab reuse). */
function tabKeyOf(path: string): string {
  return isExternalPath(path)
    ? `ext:${path}`
    : `${useVaultStore.getState().activeVaultId || ''}:${path}`;
}

function open(entry: DocLinkEntry): void {
  void openFile(entry.path, entry.name);
}

/** Ask the preview pane to restore a reading position once the path shows. */
function requestRestore(entry: DocLinkEntry): void {
  useEditorViewStateStore.getState().requestPreviewNav(entry.path, {
    scrollTop: entry.scrollTop,
    anchorId: entry.anchorId,
    components: entry.components,
  });
}

const LIMIT = 50;

/**
 * Back/forward chain for the markdown preview. Only deliberate navigations
 * are recorded (links, outline jumps, anchor jumps); opening files from the
 * tree or tab bar doesn't touch the chain. A closed tab's chain is pruned;
 * reopening that file starts a fresh session.
 */
export const useDocLinkHistory = create<DocLinkHistoryState>((set, get) => {
  // The vault is read at call time, never at module load: this module sits in
  // the startup import graph, where touching useVaultStore early is a TDZ crash.
  const syncVault = () => {
    const vaultId = useVaultStore.getState().activeVaultId;
    if (get().vaultId !== vaultId) set({ trails: {}, vaultId });
  };

  // Drop chains of tabs that no longer exist (lazy — every action prunes).
  // `protect` covers the tab this action is navigating TOWARDS: openFile
  // creates that tab asynchronously, so at action time it may legitimately
  // not exist yet — its freshly-moved chain must survive the prune.
  const prune = (protect?: string) => {
    const live = new Set(useEditorStore.getState().tabs.map((t) => t.id));
    const trails = get().trails;
    let dirty = false;
    const next: Record<string, TabTrail> = {};
    for (const id of Object.keys(trails)) {
      if (live.has(id) || id === protect) next[id] = trails[id];
      else dirty = true;
    }
    if (dirty) set({ trails: next });
  };

  // Move a chain between tab anchors: write `trail` under `toKey`, remove the
  // `fromKey` copy when the session actually left that tab.
  const moveChain = (fromKey: string | null, toKey: string, trail: TabTrail) => {
    const trails = { ...get().trails };
    if (fromKey && fromKey !== toKey) delete trails[fromKey];
    trails[toKey] = trail;
    set({ trails });
  };

  const walk = (dir: 'back' | 'forward') => {
    syncVault();
    const tabId = useEditorStore.getState().activeTabId;
    if (!tabId) return;
    const trail = get().trails[tabId];
    const leaving = dir === 'back' ? trail?.back.at(-1) : trail?.forward[0];
    if (!leaving) return;
    // Protect the destination's chain: openFile creates its tab async, so
    // the tab may not exist yet at this moment.
    prune(tabKeyOf(leaving.path));
    // The leaving position's container state comes from the tab's persisted
    // snapshot (kept fresh by the preview's MutationObserver — see
    // PreviewPane). Click-site jumps pass their live snapshot in directly.
    const leavingTab = useEditorStore.getState().tabs.find((t) => t.id === tabId);
    const from = currentEntry(savedScrollTop(), leavingTab?.previewComponents);
    const poppedBack = dir === 'back' ? trail!.back.slice(0, -1) : trail!.back;
    const poppedForward = dir === 'forward' ? trail!.forward.slice(1) : trail!.forward;
    const arrived = dir === 'back'
      ? { back: poppedBack, forward: [from, ...poppedForward].filter(Boolean) as DocLinkEntry[] }
      : { back: [...poppedBack, from].filter(Boolean) as DocLinkEntry[], forward: poppedForward };
    const toKey = tabKeyOf(leaving.path);
    moveChain(tabId, toKey, arrived);
    if (from && from.path === leaving.path) {
      // Same document already open: restore the reading position in place —
      // no reopen, no tab flash.
      requestRestore(leaving);
    } else {
      open(leaving);
      requestRestore(leaving);
    }
  };

  return {
    trails: {},
    vaultId: null,
    follow: (target, fromScrollTop, fromComponents) => {
      syncVault();
      const toKey = tabKeyOf(target.path);
      // Protect the destination's chain: openFile creates its tab async, so
      // the tab may not exist yet at this moment.
      prune(toKey);
      const fromTabId = useEditorStore.getState().activeTabId;
      const from = currentEntry(
        fromScrollTop ?? savedScrollTop(),
        fromComponents ?? activeTabComponents(),
      );
      const selfLink = from && from.path === target.path;
      if (!selfLink) open(target);
      if (from && !selfLink) {
        // The session travels: carry the source tab's chain, with the leaving
        // position appended, and drop the forward stack (new chain ahead).
        const carried = get().trails[fromTabId ?? ''] ?? { back: [], forward: [] };
        moveChain(fromTabId, toKey, {
          back: [...carried.back, from].slice(-LIMIT),
          forward: [],
        });
        if (target.anchorId) requestRestore(target);
        return;
      }
      if (from && selfLink && target.anchorId) {
        // Self-link with a fragment — an in-document jump in disguise: push
        // the leaving position so Back returns to it (same tab, same doc).
        // A bare self-link (no fragment) has no navigation effect at all.
        const trail = get().trails[toKey] ?? { back: [], forward: [] };
        set({
          trails: { ...get().trails, [toKey]: { back: [...trail.back, from].slice(-LIMIT), forward: [] } },
        });
      }
      // No document to record from (web tab): the target keeps whatever
      // chain its own session parked there.
      if (target.anchorId) requestRestore(target);
    },
    pushPosition: (fromScrollTop, fromComponents) => {
      syncVault();
      prune();
      const tabId = useEditorStore.getState().activeTabId;
      if (!tabId) return;
      const from = currentEntry(fromScrollTop, fromComponents ?? activeTabComponents());
      if (!from) return;
      const trail = get().trails[tabId] ?? { back: [], forward: [] };
      set({
        trails: { ...get().trails, [tabId]: { back: [...trail.back, from].slice(-LIMIT), forward: [] } },
      });
    },
    goBack: () => walk('back'),
    goForward: () => walk('forward'),
  };
});
