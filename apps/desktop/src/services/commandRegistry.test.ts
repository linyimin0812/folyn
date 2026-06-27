import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  registerCommand,
  registerCommands,
  getCommands,
  getCommand,
  clearCommands,
  runCommand,
  registerBuiltinCommands,
  type Command,
} from './commandRegistry';

// Mock the stores / hooks referenced by registerBuiltinCommands so seeded
// commands don't touch real persistence / Tauri IPC. vi.hoisted ensures the
// spy handles exist before vi.mock factories run (mocks are hoisted above
// imports).
const {
  toggleThemeMock,
  setCurrentPageMock,
  setActivePanelMock,
  setViewModeMock,
  openDailyNoteMock,
  setChatModeMock,
  openPanelMock,
  exportMarkdownMock,
  exportHtmlMock,
  exportPdfMock,
  requestNewItemMock,
} = vi.hoisted(() => ({
  toggleThemeMock: vi.fn(),
  setCurrentPageMock: vi.fn(),
  setActivePanelMock: vi.fn(),
  setViewModeMock: vi.fn(),
  openDailyNoteMock: vi.fn(),
  setChatModeMock: vi.fn(),
  openPanelMock: vi.fn(),
  exportMarkdownMock: vi.fn(),
  exportHtmlMock: vi.fn(),
  exportPdfMock: vi.fn(),
  requestNewItemMock: vi.fn(),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: {
    getState: () => ({
      toggleTheme: toggleThemeMock,
      setCurrentPage: setCurrentPageMock,
      enableWikiPanel: true,
      enableClipsPanel: true,
      enableAnalyzePanel: true,
      enableDailyPanel: true,
      showAiPanel: true,
    }),
  },
}));

vi.mock('@/store/editorStore', () => ({
  useEditorStore: {
    getState: () => ({
      setActivePanel: setActivePanelMock,
      setViewMode: setViewModeMock,
      openDailyNote: openDailyNoteMock,
    }),
  },
}));

vi.mock('@/store/aiStore', () => ({
  useAiStore: {
    getState: () => ({ setChatMode: setChatModeMock }),
  },
}));

vi.mock('@/store/searchStore', () => ({
  useSearchStore: {
    getState: () => ({ openPanel: openPanelMock }),
  },
}));

vi.mock('@/hooks/useExport', () => ({
  exportActiveMarkdown: exportMarkdownMock,
  exportActiveHtml: exportHtmlMock,
  exportActivePdf: exportPdfMock,
}));

vi.mock('./newItemBridge', () => ({
  requestNewItem: requestNewItemMock,
}));

function makeCommand(id: string, run: () => void = vi.fn()): Command {
  return { id, title: id, category: 'action', run };
}

beforeEach(() => {
  clearCommands();
  toggleThemeMock.mockClear();
  setCurrentPageMock.mockClear();
  setActivePanelMock.mockClear();
  setViewModeMock.mockClear();
  openDailyNoteMock.mockClear();
  setChatModeMock.mockClear();
  openPanelMock.mockClear();
  exportMarkdownMock.mockClear();
  exportHtmlMock.mockClear();
  exportPdfMock.mockClear();
  requestNewItemMock.mockClear();
});

describe('commandRegistry — basic registration', () => {
  it('registers and returns a command', () => {
    const cmd = makeCommand('a');
    registerCommand(cmd);
    expect(getCommands()).toHaveLength(1);
    expect(getCommand('a')).toBe(cmd);
  });

  it('registers many commands at once', () => {
    registerCommands([makeCommand('a'), makeCommand('b'), makeCommand('c')]);
    expect(getCommands().map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('replaces a command when re-registered with the same id', () => {
    const first = makeCommand('a');
    const second = makeCommand('a');
    registerCommand(first);
    registerCommand(second);
    expect(getCommands()).toHaveLength(1);
    expect(getCommand('a')).toBe(second);
  });

  it('clears all commands', () => {
    registerCommands([makeCommand('a'), makeCommand('b')]);
    clearCommands();
    expect(getCommands()).toHaveLength(0);
  });
});

describe('commandRegistry — runCommand', () => {
  it('runs a registered command', async () => {
    const run = vi.fn();
    registerCommand({ id: 'a', title: 'A', category: 'action', run });
    await runCommand('a');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('does not throw when the command is unknown', async () => {
    await expect(runCommand('nope')).resolves.toBeUndefined();
  });

  it('catches and logs errors from a failing command', async () => {
    const err = new Error('boom');
    const run = vi.fn(() => {
      throw err;
    });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    registerCommand({ id: 'bad', title: 'Bad', category: 'action', run });
    await expect(runCommand('bad')).resolves.toBeUndefined();
    expect(run).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('commandRegistry — registerBuiltinCommands', () => {
  it('seeds the expected action command ids', () => {
    registerBuiltinCommands();
    const ids = getCommands().filter((c) => c.category === 'action').map((c) => c.id);
    expect(ids).toEqual([
      'action.toggle-theme',
      'action.new-file',
      'action.new-folder',
      'action.open-daily-note',
      'action.export-markdown',
      'action.export-html',
      'action.export-pdf',
      'action.open-global-search',
    ]);
  });

  it('seeds the expected panel/mode command ids', () => {
    registerBuiltinCommands();
    const ids = getCommands()
      .filter((c) => c.category === 'panel-mode')
      .map((c) => c.id);
    expect(ids).toEqual([
      'panel.files',
      'panel.clips',
      'panel.wiki',
      'panel.analyze',
      'panel.calendar',
      'panel.settings',
      'mode.split',
      'mode.edit',
      'mode.preview',
      'mode.ai-chat',
      'mode.ai-wiki',
      'mode.ai-clip',
    ]);
  });

  it('seeds no file commands (files are sourced dynamically)', () => {
    registerBuiltinCommands();
    expect(getCommands().filter((c) => c.category === 'file')).toHaveLength(0);
  });

  it('is idempotent (re-seed replaces, does not duplicate)', () => {
    registerBuiltinCommands();
    registerBuiltinCommands();
    const ids = getCommands().map((c) => c.id);
    expect(ids.filter((id) => id === 'action.toggle-theme')).toHaveLength(1);
  });

  it('action.new-file switches to files panel and requests a new item', async () => {
    registerBuiltinCommands();
    await runCommand('action.new-file');
    expect(setCurrentPageMock).toHaveBeenCalledWith('editor');
    expect(setActivePanelMock).toHaveBeenCalledWith('files');
    expect(requestNewItemMock).toHaveBeenCalledWith('file');
  });

  it('action.export-pdf invokes exportActivePdf', async () => {
    registerBuiltinCommands();
    await runCommand('action.export-pdf');
    expect(exportPdfMock).toHaveBeenCalledTimes(1);
  });

  it('action.open-global-search opens the search panel', async () => {
    registerBuiltinCommands();
    await runCommand('action.open-global-search');
    expect(openPanelMock).toHaveBeenCalledTimes(1);
  });

  it('mode.preview sets the editor view mode', async () => {
    registerBuiltinCommands();
    await runCommand('mode.preview');
    expect(setViewModeMock).toHaveBeenCalledWith('preview');
  });

  it('panel.wiki sets active panel to wiki', async () => {
    registerBuiltinCommands();
    await runCommand('panel.wiki');
    expect(setCurrentPageMock).toHaveBeenCalledWith('editor');
    expect(setActivePanelMock).toHaveBeenCalledWith('wiki');
  });

  it('panel.settings opens settings page', async () => {
    registerBuiltinCommands();
    await runCommand('panel.settings');
    expect(setCurrentPageMock).toHaveBeenCalledWith('settings');
  });

  it('mode.ai-chat sets the AI chat mode', async () => {
    registerBuiltinCommands();
    await runCommand('mode.ai-chat');
    expect(setChatModeMock).toHaveBeenCalledWith('chat');
  });

  it('hides disabled panel commands when enabled() returns false', () => {
    registerBuiltinCommands();
    const wiki = getCommand('panel.wiki');
    expect(wiki?.enabled).toBeDefined();
    // Default mock has enableWikiPanel: true → visible.
    expect(wiki?.enabled?.()).toBe(true);
  });
});
