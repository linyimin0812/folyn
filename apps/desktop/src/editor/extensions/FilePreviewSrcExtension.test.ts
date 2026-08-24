import { describe, it, expect, beforeEach } from 'vitest';
import { EditorView, keymap, tooltips } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import {
  autocompletion,
  completionKeymap,
  startCompletion,
} from '@codemirror/autocomplete';
import { createFilePreviewSrcCompletion, filePreviewSrcSearchBox } from './FilePreviewSrcExtension';
import { useVaultStore } from '@/store/vaultStore';
import type { VaultEntry } from '@folyn/vault-provider';

const TREE: VaultEntry[] = [
  {
    type: 'dir',
    name: 'docs',
    path: 'docs',
    children: [
      { type: 'file', name: 'README.md', path: 'docs/README.md' },
      { type: 'file', name: 'guide.md', path: 'docs/guide.md' },
    ],
  },
  { type: 'file', name: 'notes.md', path: 'notes.md' },
];

function flush(times = 5) {
  return new Promise((r) => setTimeout(r, 0)).then(() =>
    times > 1 ? flush(times - 1) : undefined,
  );
}

function createView(doc: string, cursor: number) {
  return new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      selection: { anchor: cursor },
      extensions: [
        autocompletion({ override: [createFilePreviewSrcCompletion('index.md')], closeOnBlur: false }),
        filePreviewSrcSearchBox(),
        tooltips({ parent: document.body }),
        keymap.of([...completionKeymap]),
      ],
    }),
  });
}

function searchInput(): HTMLInputElement | null {
  return document.querySelector('.cm-src-search-box input');
}

function typeInBox(value: string) {
  const input = searchInput();
  expect(input, 'search box should exist').toBeTruthy();
  input!.value = value;
  input!.dispatchEvent(new Event('input', { bubbles: true }));
}

function pressEnterInBox() {
  const input = searchInput();
  expect(input, 'search box should exist').toBeTruthy();
  input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
}

describe('file-preview src completion + search box', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    useVaultStore.setState({ fileTree: TREE });
  });

  it('typing a query in the box then pressing Enter replaces the query with the picked path', async () => {
    const doc = ':::file-preview{src=""}';
    const cursor = doc.length - 2; // inside the quotes
    const view = createView(doc, cursor);
    startCompletion(view);
    await flush();
    await new Promise((r) => setTimeout(r, 100)); // outlast interactionDelay

    typeInBox('read');
    await flush();
    await new Promise((r) => setTimeout(r, 100));

    expect(view.state.doc.toString()).toBe(':::file-preview{src="read"}');
    pressEnterInBox();
    await flush();

    expect(view.state.doc.toString()).toBe(':::file-preview{src="docs/README.md"}');
    view.destroy();
  });

  it('drilling into a dir via Enter keeps the dropdown open with the dir children', async () => {
    const doc = ':::file-preview{src="./"}';
    const cursor = doc.length - 2;
    const view = createView(doc, cursor);
    startCompletion(view);
    await flush();
    await new Promise((r) => setTimeout(r, 100));

    // First option should be the docs/ dir — accept it.
    pressEnterInBox();
    await flush();
    await new Promise((r) => setTimeout(r, 100));

    expect(view.state.doc.toString()).toBe(':::file-preview{src="./docs/"}');
    // Dropdown reopened: box exists and shows the new partial.
    expect(searchInput()?.value).toBe('./docs/');
    view.destroy();
  });
});
