import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useCommandPaletteStore, FILE_CAP } from './commandPaletteStore';
import {
  clearCommands,
  registerCommands,
  registerBuiltinCommands,
  type Command,
} from '@/services/commandRegistry';
import type { VaultEntry } from '@quill/vault-provider';

// Mock editorStore so recent-files reads a spyable tabs array. openFile moved
// to editorIoService (PR2) — mock that separately. vi.mock factories are
// hoisted, so declare the fn via vi.hoisted.
const openFileMock = vi.hoisted(() => vi.fn());
vi.mock('@/store/editorStore', () => ({
  useEditorStore: {
    getState: () => ({
      tabs: [],
    }),
  },
}));
vi.mock('@/services/editorIoService', () => ({
  openFile: openFileMock,
}));

// Mock vaultStore with a controllable fileTree.
const fileTreeRef: { current: VaultEntry[] } = { current: [] };
vi.mock('@/store/vaultStore', () => ({
  useVaultStore: {
    getState: () => ({ fileTree: fileTreeRef.current }),
  },
}));

// Mock the navStore + appearanceStore so registerBuiltinCommands' enabled predicates resolve.
vi.mock('@/store/navStore', () => ({
  useNavStore: {
    getState: () => ({
      setCurrentPage: vi.fn(),
    }),
  },
}));
vi.mock('@/store/appearanceStore', () => ({
  useAppearanceStore: {
    getState: () => ({
      toggleTheme: vi.fn(),
      enableWikiPanel: true,
      enableClipsPanel: true,
      enableAnalyzePanel: true,
      enableDailyPanel: true,
      showAiPanel: true,
    }),
  },
}));

// Mock the remaining command dependencies so registerBuiltinCommands is safe.
vi.mock('@/store/aiStore', () => ({
  useAiStore: { getState: () => ({ setChatMode: vi.fn() }) },
}));
vi.mock('@/store/searchStore', () => ({
  useSearchStore: { getState: () => ({ openPanel: vi.fn() }) },
}));
vi.mock('@/hooks/useExport', () => ({
  exportActiveMarkdown: vi.fn(),
  exportActiveHtml: vi.fn(),
}));
vi.mock('@/services/newItemBridge', () => ({ requestNewItem: vi.fn() }));

function actionCmd(id: string, title: string, run?: () => void): Command {
  return { id, title, category: 'action', run: run ?? vi.fn() };
}
function panelCmd(id: string, title: string): Command {
  return { id, title, category: 'panel-mode', run: vi.fn() };
}
function fileCmd(id: string, title: string): Command {
  return { id, title, category: 'file', run: vi.fn() };
}

function mdFile(name: string, path?: string): VaultEntry {
  return { type: 'file', name, path: path ?? name };
}

beforeEach(() => {
  clearCommands();
  fileTreeRef.current = [];
  useCommandPaletteStore.setState({
    isOpen: false,
    query: '',
    selectedIndex: 0,
    list: { items: [], groups: [] },
  });
  openFileMock.mockClear();
});

describe('useCommandPaletteStore — open / close / toggle', () => {
  it('open() opens the palette and builds the empty-query list', () => {
    registerCommands([actionCmd('a', 'Toggle Theme')]);
    useCommandPaletteStore.getState().open();
    const s = useCommandPaletteStore.getState();
    expect(s.isOpen).toBe(true);
    expect(s.query).toBe('');
    expect(s.selectedIndex).toBe(0);
    expect(s.list.items).toHaveLength(1);
  });

  it('close() resets query and selectedIndex', () => {
    useCommandPaletteStore.setState({ isOpen: true, query: 'x', selectedIndex: 3 });
    useCommandPaletteStore.getState().close();
    const s = useCommandPaletteStore.getState();
    expect(s.isOpen).toBe(false);
    expect(s.query).toBe('');
    expect(s.selectedIndex).toBe(0);
  });

  it('toggle() opens when closed and closes when open', () => {
    useCommandPaletteStore.getState().toggle();
    expect(useCommandPaletteStore.getState().isOpen).toBe(true);
    useCommandPaletteStore.getState().toggle();
    expect(useCommandPaletteStore.getState().isOpen).toBe(false);
  });
});

describe('useCommandPaletteStore — empty-query grouped list', () => {
  it('groups items by category in default order', () => {
    registerCommands([
      actionCmd('a1', 'Toggle Theme'),
      panelCmd('p1', 'Files Panel'),
      fileCmd('f1', 'readme.md'),
    ]);
    useCommandPaletteStore.getState().open();
    const { groups } = useCommandPaletteStore.getState().list;
    const labels = groups.map((g) => g.label);
    expect(labels).toEqual(['Actions', 'Panels / Modes', 'All Files']);
  });

  it('omits the Recent Files group when there are no open tabs', () => {
    // editorStore mock exposes tabs: []
    registerCommands([actionCmd('a1', 'Toggle Theme')]);
    useCommandPaletteStore.getState().open();
    const labels = useCommandPaletteStore.getState().list.groups.map((g) => g.label);
    expect(labels).not.toContain('Recent Files');
  });

  it('exposes a flat items list aligned with groups for keyboard nav', () => {
    registerCommands([actionCmd('a1', 'A'), actionCmd('a2', 'B'), panelCmd('p1', 'P')]);
    useCommandPaletteStore.getState().open();
    const { items, groups } = useCommandPaletteStore.getState().list;
    expect(items.map((i) => i.command.id)).toEqual(
      groups.flatMap((g) => g.items.map((i) => i.command.id)),
    );
  });
});

describe('useCommandPaletteStore — setQuery filtering', () => {
  it('recomputes the list and drops non-matching commands', () => {
    registerCommands([
      actionCmd('a1', 'Toggle Theme'),
      actionCmd('a2', 'New File'),
      actionCmd('a3', 'Open Daily Note'),
    ]);
    useCommandPaletteStore.getState().open();
    useCommandPaletteStore.getState().setQuery('theme');
    const { items } = useCommandPaletteStore.getState().list;
    expect(items.map((i) => i.command.id)).toEqual(['a1']);
  });

  it('sorts matches by score descending', () => {
    registerCommands([
      actionCmd('a1', 'Toggle Theme'), // exact contiguous 'theme'
      actionCmd('a2', 'Theater System'), // 'the' scattered
    ]);
    useCommandPaletteStore.getState().open();
    useCommandPaletteStore.getState().setQuery('theme');
    const ids = useCommandPaletteStore.getState().list.items.map((i) => i.command.id);
    expect(ids[0]).toBe('a1');
  });

  it('matches against keywords', () => {
    clearCommands();
    registerCommands([
      { id: 'a1', title: 'Toggle Theme', category: 'action', keywords: ['dark', 'light'], run: vi.fn() },
    ]);
    useCommandPaletteStore.getState().open();
    useCommandPaletteStore.getState().setQuery('dark');
    expect(useCommandPaletteStore.getState().list.items.map((i) => i.command.id)).toEqual(['a1']);
  });

  it('caps file-category items at FILE_CAP', () => {
    const many: Command[] = Array.from({ length: FILE_CAP + 30 }, (_, i) =>
      fileCmd(`f${i}`, `file-${i}.md`),
    );
    registerCommands(many);
    useCommandPaletteStore.getState().open();
    useCommandPaletteStore.getState().setQuery('file');
    const files = useCommandPaletteStore.getState().list.items.filter(
      (i) => i.command.category === 'file',
    );
    expect(files.length).toBe(FILE_CAP);
  });

  it('clamps selectedIndex into range after filtering', () => {
    registerCommands([actionCmd('a1', 'A'), actionCmd('a2', 'B'), actionCmd('a3', 'C')]);
    useCommandPaletteStore.getState().open();
    useCommandPaletteStore.getState().select(2);
    expect(useCommandPaletteStore.getState().selectedIndex).toBe(2);
    useCommandPaletteStore.getState().setQuery('a'); // matches all three (title 'A','B','C' -> 'a' matches 'A' only? case-insensitive 'a' in 'B'? no)
    // 'a' matches 'A' only; selection must clamp to a valid index.
    const len = useCommandPaletteStore.getState().list.items.length;
    expect(useCommandPaletteStore.getState().selectedIndex).toBeLessThan(len);
  });
});

describe('useCommandPaletteStore — selection movement', () => {
  it('moveSelection moves down by delta', () => {
    registerCommands([actionCmd('a1', 'A'), actionCmd('a2', 'B'), actionCmd('a3', 'C')]);
    useCommandPaletteStore.getState().open();
    useCommandPaletteStore.getState().moveSelection(1);
    expect(useCommandPaletteStore.getState().selectedIndex).toBe(1);
    useCommandPaletteStore.getState().moveSelection(1);
    expect(useCommandPaletteStore.getState().selectedIndex).toBe(2);
  });

  it('moveSelection wraps around', () => {
    registerCommands([actionCmd('a1', 'A'), actionCmd('a2', 'B')]);
    useCommandPaletteStore.getState().open();
    useCommandPaletteStore.getState().moveSelection(1); // 0 -> 1
    useCommandPaletteStore.getState().moveSelection(1); // 1 -> 0 (wrap)
    expect(useCommandPaletteStore.getState().selectedIndex).toBe(0);
  });

  it('moveSelection wraps backwards', () => {
    registerCommands([actionCmd('a1', 'A'), actionCmd('a2', 'B'), actionCmd('a3', 'C')]);
    useCommandPaletteStore.getState().open();
    useCommandPaletteStore.getState().moveSelection(-1); // 0 -> 2 (wrap)
    expect(useCommandPaletteStore.getState().selectedIndex).toBe(2);
  });

  it('moveSelection on empty list keeps index at 0', () => {
    useCommandPaletteStore.getState().open();
    useCommandPaletteStore.getState().moveSelection(1);
    expect(useCommandPaletteStore.getState().selectedIndex).toBe(0);
  });
});

describe('useCommandPaletteStore — runSelected / runCommand', () => {
  it('runSelected runs the highlighted command and closes', () => {
    const run = vi.fn();
    registerCommands([actionCmd('a1', 'A', run), actionCmd('a2', 'B', vi.fn())]);
    useCommandPaletteStore.getState().open();
    useCommandPaletteStore.getState().select(0);
    useCommandPaletteStore.getState().runSelected();
    expect(run).toHaveBeenCalledTimes(1);
    expect(useCommandPaletteStore.getState().isOpen).toBe(false);
  });

  it('runSelected is a no-op when the list is empty', () => {
    useCommandPaletteStore.getState().open();
    expect(() => useCommandPaletteStore.getState().runSelected()).not.toThrow();
    // No command to run → palette stays open.
    expect(useCommandPaletteStore.getState().isOpen).toBe(true);
  });

  it('runCommand(id) runs by id and closes', () => {
    const run = vi.fn();
    registerCommands([actionCmd('a1', 'A', run)]);
    useCommandPaletteStore.getState().open();
    useCommandPaletteStore.getState().runCommand('a1');
    expect(run).toHaveBeenCalledTimes(1);
    expect(useCommandPaletteStore.getState().isOpen).toBe(false);
  });
});

describe('useCommandPaletteStore — dynamic file commands', () => {
  it('builds the "All Files" group from the live vault tree on open()', () => {
    fileTreeRef.current = [
      mdFile('a.md', 'a.md'),
      mdFile('notes/b.md', 'notes/b.md'),
      { type: 'file', name: 'c.txt', path: 'c.txt' }, // ignored (not .md)
    ];
    useCommandPaletteStore.getState().open();
    const filesGroup = useCommandPaletteStore.getState().list.groups.find(
      (g) => g.id === 'files',
    );
    expect(filesGroup).toBeDefined();
    expect(filesGroup!.items.map((i) => i.command.id)).toEqual([
      'file:a.md',
      'file:notes/b.md',
    ]);
  });

  it('caps the empty-query "All Files" group at FILE_CAP for large vaults', () => {
    fileTreeRef.current = Array.from({ length: FILE_CAP + 40 }, (_, i) =>
      mdFile(`f${i}.md`, `f${i}.md`),
    );
    useCommandPaletteStore.getState().open();
    const filesGroup = useCommandPaletteStore.getState().list.groups.find(
      (g) => g.id === 'files',
    );
    expect(filesGroup!.items).toHaveLength(FILE_CAP);
  });

  it('includes live file commands in filtered results and caps file items', () => {
    fileTreeRef.current = Array.from({ length: FILE_CAP + 10 }, (_, i) =>
      mdFile(`note-${i}.md`, `note-${i}.md`),
    );
    useCommandPaletteStore.getState().open();
    useCommandPaletteStore.getState().setQuery('note');
    const files = useCommandPaletteStore
      .getState()
      .list.items.filter((i) => i.command.category === 'file');
    expect(files).toHaveLength(FILE_CAP);
  });

  it('running a file command opens the file via editorStore.openFile', () => {
    fileTreeRef.current = [mdFile('plan.md', 'dir/plan.md')];
    useCommandPaletteStore.getState().open();
    // The first (and only) file item is at the end of the flat list.
    const fileItem = useCommandPaletteStore
      .getState()
      .list.items.find((i) => i.command.category === 'file');
    expect(fileItem).toBeDefined();
    useCommandPaletteStore.getState().runCommand(fileItem!.command.id);
    expect(openFileMock).toHaveBeenCalledWith('dir/plan.md', 'plan.md');
    expect(useCommandPaletteStore.getState().isOpen).toBe(false);
  });

  it('re-reads the tree when it changes between opens (no stale snapshot)', () => {
    fileTreeRef.current = [mdFile('old.md', 'old.md')];
    useCommandPaletteStore.getState().open();
    useCommandPaletteStore.getState().close();
    // Simulate the watcher refreshing the tree (new array reference).
    fileTreeRef.current = [mdFile('new.md', 'new.md')];
    useCommandPaletteStore.getState().open();
    const filesGroup = useCommandPaletteStore.getState().list.groups.find(
      (g) => g.id === 'files',
    );
    expect(filesGroup!.items.map((i) => i.command.id)).toEqual(['file:new.md']);
  });
});

describe('useCommandPaletteStore — builtin commands integration', () => {
  it('renders the full grouped default list with builtin commands seeded', () => {
    registerBuiltinCommands();
    fileTreeRef.current = [mdFile('readme.md', 'readme.md')];
    useCommandPaletteStore.getState().open();
    const labels = useCommandPaletteStore.getState().list.groups.map((g) => g.label);
    expect(labels).toEqual(['Actions', 'Panels / Modes', 'All Files']);
  });
});
