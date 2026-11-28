import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * PRD 11-28-md-open-preview-split-default — openFile's view-mode decision:
 * opening an EXISTING markdown file defaults to preview (the markdown
 * handler's `defaultMode`), while the create-flow caller passes an explicit
 * `{ viewMode: 'split' }` override. Background opens keep the global mode
 * untouched; re-opening an existing tab always restores that tab's saved mode.
 *
 * The registry mock comes from test/setup.desktop.ts (a real HandlerRegistry
 * without the eager glob), so `getHandlerById` / `getDefaultMode` run their
 * real derivations over the fixtures registered below — including the REAL
 * markdown handler, whose `defaultMode` is the value under test.
 */

// The real markdown handler is a fixture here, but its MarkdownPreview
// component drags the whole rendering pipeline (unified, katex, …) into the
// module graph. `defaultMode` does not depend on it — stub the component.
vi.mock('@/components/file-types/markdown/MarkdownPreview', () => ({
  MarkdownPreview: () => null,
}));

const mocks = vi.hoisted(() => {
  type MockTab = {
    id: string; name: string; path: string; content: string;
    isDirty: boolean; fileType: string; activity: string; viewMode?: string;
  };
  const state = {
    tabs: [] as MockTab[],
    activeTabId: null as string | null,
    viewMode: 'split' as string,
    isFileLoading: false,
    // addTab as editorStore's real action shape: append + activate (the
    // insertion-position/pinning logic is not under test here).
    addTab: (
      tab: MockTab,
      opts?: { activate?: boolean; insertAfterTabId?: string | null },
    ) => {
      state.tabs.push(tab);
      if (opts?.activate !== false) state.activeTabId = tab.id;
    },
  };
  return { state };
});

vi.mock('@/store/editorStore', () => ({
  useEditorStore: {
    getState: () => mocks.state,
    // Apply patches for real (openFile asserts state via getState, not via
    // setState spy args) — both the plain-object and updater-function forms.
    setState: (
      partial: Record<string, unknown> | ((s: unknown) => Record<string, unknown>),
    ) => {
      const patch = typeof partial === 'function'
        ? (partial as (s: unknown) => Record<string, unknown>)(mocks.state)
        : partial;
      Object.assign(mocks.state, patch);
    },
  },
  detectFileType: (p: string) => (p.endsWith('.md') ? 'markdown' : 'markmap'),
  detectActivity: () => 'files',
}));

vi.mock('@/store/vaultStore', () => ({
  useVaultStore: {
    getState: () => ({
      activeVaultId: 'v1',
      isLoading: false,
      readFile: async () => '# note',
      writeFile: async () => {},
    }),
  },
}));

vi.mock('@/store/editorPersistence', () => ({
  persistOpenTabs: vi.fn(),
  flushPersistOpenTabs: vi.fn(),
  loadPersistedOpenTabs: vi.fn(async () => null),
  persistExternalOpenTabs: vi.fn(),
  flushPersistExternalOpenTabs: vi.fn(),
  loadExternalOpenTabs: vi.fn(async () => null),
}));

vi.mock('@/utils/fileWatcher', () => ({ suppressWatcherFor: vi.fn() }));
vi.mock('@/store/editorAutoSave', () => ({ scheduleAutoSave: vi.fn(), flushAllAutoSaves: vi.fn() }));
vi.mock('@/services/externalFileProvider', () => ({
  externalFileProvider: {
    readFile: vi.fn(async () => ''),
    writeFile: vi.fn(async () => {}),
    writeFileBytes: vi.fn(async () => {}),
    exists: vi.fn(async () => false),
  },
}));

import { openFile } from './editorIoService';
import markdownHandler from '@/components/file-types/markdown';
import type { FileTypeProvider } from '@/components/file-types/types';
import { registerFileTypeHandler } from '@/components/file-types/registry';

const markmapHandler: FileTypeProvider = {
  id: 'markmap',
  extensions: ['mm'],
  needsFileContent: true,
  defaultMode: 'split',
  modes: [
    { id: 'edit', kind: 'shell-editor' },
    { id: 'split', kind: 'split', split: { left: 'edit', right: 'preview' } },
    { id: 'preview', kind: 'component', component: () => null },
  ],
};

// Register into the setup-file registry (fresh per test file — vitest
// isolates module state), so getHandlerById/getDefaultMode resolve for real.
registerFileTypeHandler(markdownHandler);
registerFileTypeHandler(markmapHandler);

const tab = (path: string) => mocks.state.tabs.find((t) => t.id === `v1:${path}`);

beforeEach(() => {
  mocks.state.tabs = [];
  mocks.state.activeTabId = null;
  mocks.state.viewMode = 'split';
  mocks.state.isFileLoading = false;
});

describe('openFile view-mode decision (PRD: existing md opens in preview)', () => {
  it("markdown handler's defaultMode is 'preview' with modes order unchanged", () => {
    expect(markdownHandler.defaultMode).toBe('preview');
    expect(markdownHandler.modes.map((m) => m.id)).toEqual(['edit', 'split', 'preview']);
  });

  it('opening an existing .md without an override → preview tab + global viewMode preview', async () => {
    await openFile('notes/topic.md', 'topic.md');
    expect(tab('notes/topic.md')?.viewMode).toBe('preview');
    expect(mocks.state.viewMode).toBe('preview');
    expect(mocks.state.activeTabId).toBe('v1:notes/topic.md');
  });

  it("an explicit viewMode override (the create flow) → the new tab opens in 'split'", async () => {
    await openFile('fresh.md', 'fresh.md', { viewMode: 'split' });
    expect(tab('fresh.md')?.viewMode).toBe('split');
    expect(mocks.state.viewMode).toBe('split');
  });

  it('a background open carries its own viewMode but never touches the global one', async () => {
    mocks.state.tabs = [{
      id: 'v1:other.md', name: 'other.md', path: 'other.md', content: 'x',
      isDirty: false, fileType: 'markdown', activity: 'files', viewMode: 'edit',
    }];
    mocks.state.activeTabId = 'v1:other.md';
    mocks.state.viewMode = 'edit';

    await openFile('bg.md', 'bg.md', { background: true, insertAfterTabId: 'v1:other.md' });

    expect(tab('bg.md')?.viewMode).toBe('preview'); // tab keeps its own mode
    expect(mocks.state.activeTabId).toBe('v1:other.md'); // not activated
    expect(mocks.state.viewMode).toBe('edit'); // global mode untouched
  });

  it('re-opening an existing tab restores its saved viewMode — the override is ignored', async () => {
    mocks.state.tabs = [{
      id: 'v1:a.md', name: 'a.md', path: 'a.md', content: 'kept',
      isDirty: false, fileType: 'markdown', activity: 'files', viewMode: 'edit',
    }];

    await openFile('a.md', 'a.md', { viewMode: 'split' });

    expect(mocks.state.tabs).toHaveLength(1); // no duplicate tab
    expect(mocks.state.tabs[0].viewMode).toBe('edit'); // saved mode wins
    expect(mocks.state.viewMode).toBe('edit');
  });

  it('an existing tab without a saved viewMode (legacy / restored session) lands on the handler default', async () => {
    mocks.state.tabs = [{
      id: 'v1:legacy.md', name: 'legacy.md', path: 'legacy.md', content: 'x',
      isDirty: false, fileType: 'markdown', activity: 'files',
    }];

    await openFile('legacy.md', 'legacy.md');

    expect(mocks.state.viewMode).toBe('preview');
  });

  it('non-markdown handlers keep their own default (markmap stays split)', async () => {
    await openFile('mind.mm', 'mind.mm');
    expect(tab('mind.mm')?.viewMode).toBe('split');
    expect(mocks.state.viewMode).toBe('split');
  });
});
