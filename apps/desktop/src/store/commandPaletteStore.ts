import { create } from 'zustand';
import {
  getCommands,
  runCommand,
  type Command,
  type CommandCategory,
} from '@/services/commandRegistry';
import { fuzzyMatch } from '@/utils/fuzzyMatch';
import { useEditorStore, type FileTab } from '@/store/editorStore';
import * as editorIoService from '@/services/editorIoService';
import { useVaultStore } from '@/store/vaultStore';
import { buildFileCommands } from '@/services/fileCommands';

/**
 * Headless UI state for the unified command palette (⌘P).
 *
 * Static commands (actions + panels/modes) come from the command registry.
 * File commands are built lazily from the live `vaultStore.fileTree` at
 * `open()` / `setQuery()` time so they always reflect the watched tree (no
 * registry churn, no stale snapshot).
 *
 * Derived items are recomputed on `open()` and `setQuery()`.
 */

/** Cap on rendered file-category items to bound DOM size for large vaults. */
export const FILE_CAP = 50;

export interface PaletteItem {
  command: Command;
  /** Fuzzy match score (0 for unfiltered / empty-query items). */
  score: number;
  /** Indices into `command.title` for highlight rendering (PR2). */
  matches: number[];
}

export interface PaletteGroup {
  /** Group id; stable for ordering. */
  id: string;
  label: string;
  items: PaletteItem[];
}

export interface PaletteFlatList {
  /** Flat ordered list across all groups (drives keyboard navigation). */
  items: PaletteItem[];
  /** Grouped structure for rendering. */
  groups: PaletteGroup[];
}

interface CommandPaletteState {
  isOpen: boolean;
  query: string;
  selectedIndex: number;
  /** Flat + grouped view recomputed on open / setQuery. */
  list: PaletteFlatList;

  // Actions
  open: () => void;
  close: () => void;
  toggle: () => void;
  setQuery: (q: string) => void;
  moveSelection: (delta: number) => void;
  select: (index: number) => void;
  runSelected: () => void;
  runCommand: (id: string) => void;
}

/** Build a file command for an already-open tab (used by the Recent Files group). */
function fileCommandFromTab(tab: FileTab): Command {
  return {
    id: `file.tab.${tab.path}`,
    title: tab.name,
    category: 'file',
    keywords: [tab.path],
    run: () => {
      void editorIoService.openFile(tab.path, tab.name);
    },
  };
}

/** Static commands that are currently visible (enabled predicate respected). */
function visibleStaticCommands(): Command[] {
  return getCommands().filter((c) => !c.enabled || c.enabled());
}

/** File commands sourced from the live vault tree (capped for the empty-query group). */
function liveFileCommands(): Command[] {
  const { fileTree } = useVaultStore.getState();
  return buildFileCommands(fileTree);
}

/** Build the empty-query grouped default list. */
function buildEmptyQueryList(): PaletteFlatList {
  const commands = visibleStaticCommands();
  const tabs = useEditorStore.getState().tabs;

  const byCategory = (cat: CommandCategory): PaletteItem[] =>
    commands
      .filter((c) => c.category === cat)
      .map((c) => ({ command: c, score: 0, matches: [] }));

  const recent: PaletteItem[] = tabs.map((t) => ({
    command: fileCommandFromTab(t),
    score: 0,
    matches: [],
  }));

  // "All Files" comes from the live vault tree, capped to bound DOM size.
  const allFiles: PaletteItem[] = liveFileCommands()
    .slice(0, FILE_CAP)
    .map((c) => ({ command: c, score: 0, matches: [] }));

  const groups: PaletteGroup[] = [
    { id: 'actions', label: 'Actions', items: byCategory('action') },
    { id: 'panel-mode', label: 'Panels / Modes', items: byCategory('panel-mode') },
    { id: 'recent', label: 'Recent Files', items: recent },
    { id: 'files', label: 'All Files', items: allFiles },
  ].filter((g) => g.items.length > 0 || g.id === 'actions' || g.id === 'files');

  const items = groups.flatMap((g) => g.items);
  return { items, groups };
}

/** Fuzzy-score every candidate, drop non-matches, sort, and cap file items. */
function buildFilteredList(query: string): PaletteFlatList {
  const tabs = useEditorStore.getState().tabs;

  // Candidate set: visible static commands + open-tab file commands (recent) +
  // file commands from the live vault tree.
  const candidates: Command[] = [
    ...visibleStaticCommands(),
    ...tabs.map((t) => fileCommandFromTab(t)),
    ...liveFileCommands(),
  ];

  const scored: PaletteItem[] = [];
  for (const cmd of candidates) {
    const titleResult = fuzzyMatch(query, cmd.title);
    let best = titleResult;
    for (const kw of cmd.keywords ?? []) {
      const r = fuzzyMatch(query, kw);
      if (r && (!best || r.score > best.score)) best = r;
    }
    if (!best) continue;
    // Use the title match indices for highlight (most relevant to display).
    const matches = titleResult ? titleResult.matches : [];
    scored.push({ command: cmd, score: best.score, matches });
  }

  scored.sort((a, b) => b.score - a.score);

  // Cap file-category items to bound DOM size for large vaults.
  let fileCount = 0;
  const items: PaletteItem[] = [];
  for (const item of scored) {
    if (item.command.category === 'file') {
      if (fileCount >= FILE_CAP) continue;
      fileCount++;
    }
    items.push(item);
  }

  // Group the flat list by category for rendering.
  const order: CommandCategory[] = ['action', 'panel-mode', 'file'];
  const groups: PaletteGroup[] = order
    .map((cat) => ({
      id: cat,
      label:
        cat === 'action' ? 'Actions' : cat === 'panel-mode' ? 'Panels / Modes' : 'All Files',
      items: items.filter((i) => i.command.category === cat),
    }))
    .filter((g) => g.items.length > 0);

  return { items, groups };
}

function clampIndex(index: number, len: number): number {
  if (len === 0) return 0;
  if (index < 0) return 0;
  if (index >= len) return len - 1;
  return index;
}

export const useCommandPaletteStore = create<CommandPaletteState>((set, get) => ({
  isOpen: false,
  query: '',
  selectedIndex: 0,
  list: { items: [], groups: [] },

  open: () =>
    set({
      isOpen: true,
      query: '',
      selectedIndex: 0,
      list: buildEmptyQueryList(),
    }),

  close: () => set({ isOpen: false, query: '', selectedIndex: 0 }),

  toggle: () => {
    if (get().isOpen) get().close();
    else get().open();
  },

  setQuery: (q) => {
    const list = q.length === 0 ? buildEmptyQueryList() : buildFilteredList(q);
    set({ query: q, list, selectedIndex: clampIndex(get().selectedIndex, list.items.length) });
  },

  moveSelection: (delta) => {
    const len = get().list.items.length;
    if (len === 0) {
      set({ selectedIndex: 0 });
      return;
    }
    // Wrap around the flat list.
    let next = (get().selectedIndex + delta) % len;
    if (next < 0) next += len;
    set({ selectedIndex: next });
  },

  select: (index) => {
    const len = get().list.items.length;
    set({ selectedIndex: clampIndex(index, len) });
  },

  runSelected: () => {
    const { list, selectedIndex } = get();
    const item = list.items[selectedIndex];
    if (!item) return;
    set({ isOpen: false, query: '', selectedIndex: 0 });
    void runPaletteItem(item);
  },

  runCommand: (id) => {
    const item = get().list.items.find((i) => i.command.id === id);
    set({ isOpen: false, query: '', selectedIndex: 0 });
    if (item) {
      void runPaletteItem(item);
    } else {
      // Fallback: a registered command not currently in the visible list.
      void runCommand(id);
    }
  },
}));

/**
 * Run a palette item's command, catching errors so a single failing command
 * cannot break the palette. Mirrors the registry's safe-run contract, but
 * operates on the in-memory item so dynamically-built file commands (not in the
 * static registry) are executable.
 */
async function runPaletteItem(item: PaletteItem): Promise<void> {
  try {
    await item.command.run();
  } catch (err) {
    console.error(`[commandPalette] command "${item.command.id}" failed:`, err);
  }
}
