import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EditorView, keymap, tooltips } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import {
  autocompletion,
  completionKeymap,
  startCompletion,
} from '@codemirror/autocomplete';
import { createMarkdownImageCompletion } from './MarkdownImageExtension';
import { useVaultStore } from '@/store/vaultStore';
import type { VaultEntry } from '@folyn/vault-provider';

// Mock Tauri fs + path APIs for ~/ path completion tests.
const MOCK_HOME = '/Users/testuser';
const MOCK_FS: Record<string, { name: string; isDirectory: boolean }[]> = {};

vi.mock('@tauri-apps/plugin-fs', () => ({
  readDir: vi.fn(async (dir: string) => MOCK_FS[dir] ?? []),
  exists: vi.fn(async (dir: string) => dir in MOCK_FS),
}));
vi.mock('@tauri-apps/api/path', () => ({
  homeDir: vi.fn(async () => MOCK_HOME),
  join: vi.fn(async (...parts: string[]) => parts.join('/')),
}));

const TREE: VaultEntry[] = [
  {
    type: 'dir',
    name: 'assets',
    path: 'assets',
    children: [
      { type: 'file', name: 'pic.png', path: 'assets/pic.png' },
      { type: 'file', name: 'logo.svg', path: 'assets/logo.svg' },
      { type: 'file', name: 'notes.md', path: 'assets/notes.md' },
    ],
  },
  { type: 'file', name: 'cover.jpg', path: 'cover.jpg' },
  { type: 'file', name: 'readme.md', path: 'readme.md' },
];

function flush(times = 5) {
  return new Promise((r) => setTimeout(r, 0)).then(() =>
    times > 1 ? flush(times - 1) : undefined,
  );
}

function createView(doc: string, cursor: number, filePath = 'index.md') {
  return new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      selection: { anchor: cursor },
      extensions: [
        autocompletion({
          override: [createMarkdownImageCompletion(filePath)],
          closeOnBlur: false,
          interactionDelay: 0,
        }),
        tooltips({ parent: document.body }),
        keymap.of([...completionKeymap]),
      ],
    }),
  });
}

describe('markdown image completion', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    useVaultStore.setState({ fileTree: TREE });
  });

  it('returns null when cursor is not inside image syntax', () => {
    const view = createView('hello world', 5);
    startCompletion(view);
    expect(document.querySelector('.cm-tooltip-autocomplete')).toBeNull();
    view.destroy();
  });

  it('shows only image files in global search (no slash)', async () => {
    const doc = '![]()';
    const cursor = doc.length - 1;
    const view = createView(doc, cursor);
    startCompletion(view);
    await flush();
    await new Promise((r) => setTimeout(r, 100));

    const items = Array.from(document.querySelectorAll('.cm-tooltip-autocomplete li')).map(
      (li) => li.textContent,
    );
    expect(items).toContain('assets/pic.png');
    expect(items).toContain('assets/logo.svg');
    expect(items).toContain('cover.jpg');
    expect(items).not.toContain('assets/notes.md');
    expect(items).not.toContain('readme.md');
    view.destroy();
  });

  it('drills into a directory and shows image children only', async () => {
    const doc = '![](assets/)';
    const cursor = doc.length - 1;
    const view = createView(doc, cursor);
    startCompletion(view);
    await flush();
    await new Promise((r) => setTimeout(r, 100));

    const items = Array.from(document.querySelectorAll('.cm-tooltip-autocomplete li')).map(
      (li) => li.textContent,
    );
    expect(items).toContain('pic.png');
    expect(items).toContain('logo.svg');
    expect(items).not.toContain('notes.md');
    view.destroy();
  });

  it('resolves ./ relative to the current file directory', async () => {
    const treeWithDocs: VaultEntry[] = [
      {
        type: 'dir',
        name: 'docs',
        path: 'docs',
        children: [
          { type: 'file', name: 'screenshot.png', path: 'docs/screenshot.png' },
          { type: 'file', name: 'index.md', path: 'docs/index.md' },
        ],
      },
    ];
    useVaultStore.setState({ fileTree: treeWithDocs });

    const doc = '![](./)';
    const cursor = doc.length - 1;
    const view = createView(doc, cursor, 'docs/index.md');
    startCompletion(view);
    await flush();
    await new Promise((r) => setTimeout(r, 100));

    const items = Array.from(document.querySelectorAll('.cm-tooltip-autocomplete li')).map(
      (li) => li.textContent,
    );
    expect(items).toContain('screenshot.png');
    expect(items).not.toContain('index.md');
    view.destroy();
  });

  it('lists image files in ~/ directory via Tauri fs', async () => {
    const homeDir = `${MOCK_HOME}/Pictures`;
    MOCK_FS[homeDir] = [
      { name: 'photo.jpg', isDirectory: false },
      { name: 'icon.png', isDirectory: false },
      { name: 'notes.txt', isDirectory: false },
      { name: 'subfolder', isDirectory: true },
    ];

    const doc = '![](~/Pictures/)';
    const cursor = doc.length - 1;
    const view = createView(doc, cursor);
    startCompletion(view);
    await flush(10);
    await new Promise((r) => setTimeout(r, 500));

    const items = Array.from(document.querySelectorAll('.cm-tooltip-autocomplete li')).map(
      (li) => li.textContent,
    );
    expect(items).toContain('photo.jpg');
    expect(items).toContain('icon.png');
    expect(items).toContain('subfolder/');
    expect(items).not.toContain('notes.txt');
    view.destroy();
  });
});
