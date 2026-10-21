import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { history, undo, undoDepth } from '@codemirror/commands';

const mocks = vi.hoisted(() => ({
  editor: {
    tabs: [] as Array<{ id: string; path: string; name: string; content: string; isDirty: boolean; fileType: string; activity: string }>,
    activeTabId: 'a:notes/topic.md', activePanel: 'files', setViewMode: vi.fn(),
  },
  editorListeners: new Set<() => void>(), vaultListeners: new Set<() => void>(),
  open: vi.fn(), handler: vi.fn(), navigate: vi.fn(), presentation: vi.fn(), historyVisible: vi.fn(),
  current: true,
}));
vi.mock('@/store/editorStore', () => ({ useEditorStore: {
  getState: () => mocks.editor,
  setState: (value: Partial<typeof mocks.editor>) => { Object.assign(mocks.editor, value); },
  subscribe: (callback: () => void) => { mocks.editorListeners.add(callback); return () => mocks.editorListeners.delete(callback); },
} }));
vi.mock('@/store/vaultStore', () => ({ useVaultStore: { subscribe: (callback: () => void) => { mocks.vaultListeners.add(callback); return () => mocks.vaultListeners.delete(callback); } } }));
vi.mock('@/store/editorViewState', () => ({ useEditorViewStateStore: { getState: () => ({ setPresentationMode: mocks.presentation, setVersionHistoryVisible: mocks.historyVisible }) } }));
vi.mock('@/store/navStore', () => ({ useNavStore: { getState: () => ({ setCurrentPage: mocks.navigate }) } }));
vi.mock('@/components/file-types/registry', () => ({ getHandlerById: mocks.handler }));
vi.mock('./editorIoService', () => ({ openFile: mocks.open }));
import { appendNoteInEditor, readEditedNoteText } from './editorNoteService';
import { setActiveEditorHandle } from './editorHandleRegistry';

const views: EditorView[] = [];
const original = '# Topic\nMy unsaved thought';
function registerView(text = original, tabId = 'a:notes/topic.md', readonly = false) {
  const view = new EditorView({ state: EditorState.create({ doc: text, extensions: [
    history(), EditorState.readOnly.of(readonly),
    EditorView.updateListener.of(update => {
      if (!update.docChanged) return;
      const tab = mocks.editor.tabs.find(candidate => candidate.id === tabId);
      if (tab) { tab.content = update.state.doc.toString(); tab.isDirty = true; }
    }),
  ] }), parent: document.body });
  views.push(view);
  setActiveEditorHandle({ getView: () => view, getScrollDOM: () => view.scrollDOM, replaceContent: () => {} }, tabId);
  return view;
}
function options(expectedText = original) {
  return { vaultId: 'a', path: 'notes/topic.md', text: '## Learning\nMy new note', expectedText,
    readText: async () => mocks.editor.tabs[0].content,
    assertCurrent() { if (!mocks.current) throw new Error('The selected vault has changed'); },
  };
}
async function flush() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
beforeEach(() => {
  vi.clearAllMocks();
  mocks.current = true;
  mocks.editor.tabs = [{ id: 'a:notes/topic.md', path: 'notes/topic.md', name: 'topic.md', content: original, isDirty: true, fileType: 'markdown', activity: 'files' }];
  mocks.editor.activeTabId = 'a:notes/topic.md';
  mocks.editorListeners.clear(); mocks.vaultListeners.clear();
  mocks.open.mockResolvedValue(undefined);
  mocks.handler.mockReturnValue({ modes: [{ id: 'source', kind: 'shell-editor' }] });
});
afterEach(() => {
  setActiveEditorHandle(null);
  for (const view of views.splice(0)) view.destroy();
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('native learning-note append', () => {
  it('prefers a dirty current editor and preserves an intentionally empty dirty buffer', () => {
    registerView('latest live edit');
    expect(readEditedNoteText('a', 'notes/topic.md')).toBe('latest live edit');
    setActiveEditorHandle(null);
    mocks.editor.tabs[0].content = '';
    expect(readEditedNoteText('a', 'notes/topic.md')).toBe('');
    expect(readEditedNoteText('b', 'notes/topic.md')).toBeUndefined();
    mocks.editor.tabs[0].isDirty = false;
    expect(readEditedNoteText('a', 'notes/topic.md')).toBeUndefined();
  });

  it('appends one undoable transaction, preserving earlier unsaved edits and opening source mode', async () => {
    const view = registerView();
    await appendNoteInEditor(options());
    expect(view.state.doc.toString()).toBe(`${original}\n\n## Learning\nMy new note`);
    expect(mocks.editor.tabs[0].content).toBe(view.state.doc.toString());
    expect(mocks.editor.tabs[0].isDirty).toBe(true);
    expect(mocks.open).toHaveBeenCalledWith('notes/topic.md', 'topic.md', expect.objectContaining({ expectedVaultId: 'a' }));
    expect(mocks.editor.setViewMode).toHaveBeenCalledWith('source');
    expect(mocks.navigate).toHaveBeenCalledWith('editor');
    expect(mocks.presentation).toHaveBeenCalledWith(false);
    expect(mocks.historyVisible).toHaveBeenCalledWith(false);
    expect(undoDepth(view.state)).toBe(1);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(original);
    expect(mocks.editorListeners.size).toBe(0); expect(mocks.vaultListeners.size).toBe(0);
  });

  it('keeps the append separate from preceding typing in undo history', async () => {
    const view = registerView();
    view.dispatch({ changes: { from: view.state.doc.length, insert: ' typing' }, userEvent: 'input.type' });
    const beforeAppend = view.state.doc.toString();
    await appendNoteInEditor(options(beforeAppend));
    expect(undoDepth(view.state)).toBe(2);
    undo(view); expect(view.state.doc.toString()).toBe(beforeAppend);
    undo(view); expect(view.state.doc.toString()).toBe(original);
  });

  it('does not add blank prefix lines when appending to an empty dirty note', async () => {
    mocks.editor.tabs[0].content = '';
    const view = registerView('');
    await appendNoteInEditor(options(''));
    expect(view.state.doc.toString()).toBe('## Learning\nMy new note');
  });

  it('rejects a stale preview before opening any editor', async () => {
    await expect(appendNoteInEditor(options('older preview'))).rejects.toThrow('note has changed');
    expect(mocks.open).not.toHaveBeenCalled();
  });

  it('waits for the matching target handle instead of dispatching to an identically worded previous tab', async () => {
    const wrongView = registerView(original, 'a:other.md');
    const pending = appendNoteInEditor(options());
    await flush();
    expect(wrongView.state.doc.toString()).toBe(original);
    expect(mocks.editorListeners.size).toBe(1);
    const rightView = registerView();
    await pending;
    expect(wrongView.state.doc.toString()).toBe(original);
    expect(rightView.state.doc.toString()).toContain('## Learning');
  });

  it('compares again after mounting the editor and preserves newer edits', async () => {
    const pending = appendNoteInEditor(options());
    const rejection = expect(pending).rejects.toThrow('note has changed');
    await flush();
    const view = registerView('updated while mounting');
    await rejection;
    expect(view.state.doc.toString()).toBe('updated while mounting');
  });

  it('rejects a vault switch during IO before opening a target', async () => {
    let finish: (text: string) => void = () => {};
    const pending = appendNoteInEditor({ ...options(), readText: () => new Promise<string>(resolve => { finish = resolve; }) });
    const rejection = expect(pending).rejects.toThrow('vault has changed');
    mocks.current = false; finish(original);
    await rejection;
    expect(mocks.open).not.toHaveBeenCalled();
  });

  it('rejects a vault switch while waiting and cleans up readiness listeners', async () => {
    const pending = appendNoteInEditor(options());
    const rejection = expect(pending).rejects.toThrow('vault has changed');
    await flush();
    mocks.current = false; for (const listener of mocks.vaultListeners) listener();
    await rejection;
    expect(mocks.editorListeners.size).toBe(0); expect(mocks.vaultListeners.size).toBe(0);
  });

  it('rejects switching to another target while waiting', async () => {
    const pending = appendNoteInEditor(options());
    const rejection = expect(pending).rejects.toThrow('selected note has changed');
    await flush();
    mocks.editor.activeTabId = 'a:other.md'; for (const listener of mocks.editorListeners) listener();
    await rejection;
  });

  it('rejects readonly editors without changing them', async () => {
    const view = registerView(original, undefined, true);
    await expect(appendNoteInEditor(options())).rejects.toThrow('read-only');
    expect(view.state.doc.toString()).toBe(original);
  });

  it('rejects providers without a native source editor', async () => {
    mocks.handler.mockReturnValue({ modes: [{ id: 'visual', kind: 'component' }] });
    await expect(appendNoteInEditor(options())).rejects.toThrow('native text editor');
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('rejects empty additions without reading or opening a note', async () => {
    const readText = vi.fn();
    await expect(appendNoteInEditor({ ...options(), text: '  ', readText })).rejects.toThrow('no note content');
    expect(readText).not.toHaveBeenCalled(); expect(mocks.open).not.toHaveBeenCalled();
  });

  it('allows only one simultaneous append against the same expected snapshot', async () => {
    const view = registerView();
    const results = await Promise.allSettled([appendNoteInEditor(options()), appendNoteInEditor(options())]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect(view.state.doc.toString().match(/## Learning/g)).toHaveLength(1);
  });

  it('reports unavailable editors and cleans up instead of waiting indefinitely', async () => {
    vi.useFakeTimers();
    const pending = appendNoteInEditor(options());
    const rejection = expect(pending).rejects.toThrow('not available');
    await vi.advanceTimersByTimeAsync(5001);
    await rejection;
    expect(mocks.editorListeners.size).toBe(0); expect(mocks.vaultListeners.size).toBe(0);
  });
});
