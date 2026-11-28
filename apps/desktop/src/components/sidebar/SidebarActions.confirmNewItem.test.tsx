import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';

/**
 * PRD 11-28-md-open-preview-split-default — confirmNewItem's pass-through:
 * a freshly created .md is opened with the explicit `{ viewMode: 'split' }`
 * override (the user is about to write), while any other created file passes
 * no override (its own handler default applies). detectFileType — not a bare
 * extension check — decides, so an Open-With preference away from the
 * markdown handler is respected.
 */

const mocks = vi.hoisted(() => ({
  createFile: vi.fn(async () => {}),
  createDir: vi.fn(async () => {}),
  deleteFile: vi.fn(async () => {}),
  deleteDir: vi.fn(async () => {}),
  renameFile: vi.fn(async () => {}),
}));

vi.mock('@/store/vaultStore', () => ({
  // Selector-call shape: the hook does useVaultStore((s) => s.createFile).
  useVaultStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      createFile: mocks.createFile,
      createDir: mocks.createDir,
      deleteFile: mocks.deleteFile,
      deleteDir: mocks.deleteDir,
      renameFile: mocks.renameFile,
    }),
}));

vi.mock('@/store/editorStore', () => ({
  useEditorStore: { getState: () => ({ tabs: [] }) },
  detectFileType: (p: string) => (p.endsWith('.md') ? 'markdown' : 'other'),
}));

vi.mock('@/store/prefsStore', () => ({
  usePrefsStore: { getState: () => ({ fileTemplates: {} }) },
}));

vi.mock('@/services/extension-host/fileTemplateAdapter', () => ({
  getFileTemplateForExtension: () => undefined,
}));

vi.mock('@/services/editorIoService', () => ({ closeTab: vi.fn() }));

import { useSidebarActions } from './SidebarActions';

const handleFileClick = vi.fn();
const setExpandedDirs = vi.fn();
const revealItem = vi.fn();

/** Drive the inline new-file flow: start → type name → confirm. */
async function createItemViaInput(type: 'file' | 'dir', name: string) {
  const { result } = renderHook(() =>
    useSidebarActions({ handleFileClick, setExpandedDirs, revealItem }),
  );
  act(() => result.current.startNewItem(type));
  act(() => result.current.setNewItemName(name));
  await act(async () => {
    await result.current.confirmNewItem();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => cleanup());

describe('confirmNewItem — created-file open mode (PRD: created md opens split)', () => {
  it('a created .md opens via handleFileClick with the split override', async () => {
    await createItemViaInput('file', 'note');
    // name without extension → defaults to .md, empty starter content
    expect(mocks.createFile).toHaveBeenCalledWith('note.md', '');
    expect(handleFileClick).toHaveBeenCalledWith('note.md', 'note.md', { viewMode: 'split' });
    expect(revealItem).toHaveBeenCalledWith('note.md');
  });

  it('a created non-md file passes no override (its handler default applies)', async () => {
    await createItemViaInput('file', 'diagram.mm');
    expect(mocks.createFile).toHaveBeenCalledWith('diagram.mm', '');
    expect(handleFileClick).toHaveBeenCalledWith('diagram.mm', 'diagram.mm', undefined);
  });

  it('creating a folder never opens a tab', async () => {
    await createItemViaInput('dir', 'stuff');
    expect(mocks.createDir).toHaveBeenCalledWith('stuff');
    expect(handleFileClick).not.toHaveBeenCalled();
    expect(setExpandedDirs).toHaveBeenCalled();
  });
});
