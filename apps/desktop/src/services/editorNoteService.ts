/** Editor-owned note handoff for explicit learning-note appends. */
import { isolateHistory } from '@codemirror/commands';
import type { EditorView } from '@codemirror/view';
import { useEditorStore } from '@/store/editorStore';
import { useEditorViewStateStore } from '@/store/editorViewState';
import { useVaultStore } from '@/store/vaultStore';
import { useNavStore } from '@/store/navStore';
import { getHandlerById } from '@/components/file-types/registry';
import { openFile } from './editorIoService';
import { getActiveEditorHandleFor, onActiveEditorHandleChange } from './editorHandleRegistry';

/** A clean tab may be stale relative to disk. Only unsaved text takes priority. */
export function readEditedNoteText(vaultId: string, path: string): string | undefined {
  const tabId = `${vaultId}:${path}`;
  const tab = useEditorStore.getState().tabs.find(candidate => candidate.id === tabId);
  if (!tab?.isDirty) return undefined;
  return getActiveEditorHandleFor(tabId)?.getView()?.state.doc.toString() ?? tab.content;
}

interface AppendNoteOptions {
  vaultId: string;
  path: string;
  text: string;
  expectedText: string;
  readText(): Promise<string>;
  assertCurrent(): void;
}

function waitForNoteEditor(tabId: string, assertCurrent: () => void): Promise<EditorView> {
  return new Promise((resolve, reject) => {
    let stopHandle = () => {};
    let stopVault = () => {};
    let stopEditor = () => {};
    const cleanup = () => {
      clearTimeout(timer);
      stopHandle(); stopVault(); stopEditor();
    };
    const fail = (error: unknown) => { cleanup(); reject(error); };
    const check = () => {
      try {
        assertCurrent();
        const editor = useEditorStore.getState();
        if (editor.activeTabId !== tabId || !editor.tabs.some(tab => tab.id === tabId)) {
          throw new Error('The selected note has changed; choose it again');
        }
        const view = getActiveEditorHandleFor(tabId)?.getView();
        if (view) { cleanup(); resolve(view); }
      } catch (error) { fail(error); }
    };
    const timer = setTimeout(() => fail(new Error('The note editor is not available; open the note and retry')), 5000);
    stopHandle = onActiveEditorHandleChange(check);
    stopVault = useVaultStore.subscribe(check);
    stopEditor = useEditorStore.subscribe(check);
    check();
  });
}

export async function appendNoteInEditor(options: AppendNoteOptions): Promise<void> {
  const { vaultId, path, text, expectedText, assertCurrent } = options;
  assertCurrent();
  if (!text.trim()) throw new Error('There is no note content to append');
  const currentText = await options.readText();
  assertCurrent();
  if (currentText !== expectedText) throw new Error('The note has changed; review the latest content before appending');
  await openFile(path, path.split('/').pop() || path, { expectedVaultId: vaultId, readText: async () => currentText });
  assertCurrent();
  const editor = useEditorStore.getState();
  const tabId = `${vaultId}:${path}`;
  const tab = editor.tabs.find(candidate => candidate.id === tabId);
  const sourceMode = tab && getHandlerById(tab.fileType)?.modes.find(mode => mode.kind === 'shell-editor');
  if (!sourceMode) throw new Error('The selected note does not provide a native text editor');
  // Set the panel directly: setActivePanel would select a different first tab.
  useEditorStore.setState({ activePanel: 'files' });
  useEditorStore.getState().setViewMode(sourceMode.id);
  useEditorViewStateStore.getState().setPresentationMode(false);
  useEditorViewStateStore.getState().setVersionHistoryVisible(false);
  useNavStore.getState().setCurrentPage('editor');
  const view = await waitForNoteEditor(tabId, assertCurrent);
  // Tab swaps release their editor write-back guard in a microtask.
  await Promise.resolve();
  assertCurrent();
  if (useEditorStore.getState().activeTabId !== tabId || getActiveEditorHandleFor(tabId)?.getView() !== view) {
    throw new Error('The selected note has changed; choose it again');
  }
  if (view.state.readOnly) throw new Error('The selected note editor is read-only');
  if (view.state.doc.toString() !== expectedText) {
    throw new Error('The note has changed; review the latest content before appending');
  }
  const end = view.state.doc.length;
  const separator = !expectedText || expectedText.endsWith('\n\n') ? '' : expectedText.endsWith('\n') ? '\n' : '\n\n';
  const insert = separator + text;
  view.dispatch({
    changes: { from: end, insert },
    selection: { anchor: end + insert.length },
    annotations: isolateHistory.of('full'),
    userEvent: 'input',
    scrollIntoView: true,
  });
  view.focus();
}
