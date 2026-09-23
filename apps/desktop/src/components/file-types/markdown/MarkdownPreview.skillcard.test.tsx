// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { createElement } from 'react';

vi.mock('../excalidraw/ExcalidrawPreview', () => ({ ExcalidrawPreview: () => null }));
// ponytail: mock the registry + ai store so the import graph skips the
// heavy file-type components (excalidraw dist → open-color JSON, markmap
// → window.katex) and the provider catalog — the gating test only needs
// the markdown pipeline itself.
vi.mock('@/components/file-types/registry', () => ({
  getHandlerByExtension: () => null,
  getHandlerById: () => null,
  getModeComponent: () => null,
}));
vi.mock('@/store/aiConfigStore', () => ({ useAiConfigStore: () => ({}) }));

import { MarkdownPreview } from './MarkdownPreview';

const renderDoc = (content: string) =>
  render(createElement(MarkdownPreview, { content, filePath: '/tmp/note.md', vaultRoot: '', onChange: () => {}, cursorLine: 0, cursorViewportY: 0, editorViewportTop: 0, hasSelection: false }));

describe('SKILL meta card gating', () => {
  it('plain frontmatter shows the meta card but no SKILL badge', () => {
    const u = renderDoc('---\ntitle: foo\ndate: 2026-01-01\n---\n\nhello');
    expect(u.container.querySelector('.skill-meta-card')).not.toBeNull();
    expect(u.container.querySelector('.skill-meta-badge')).toBeNull();
    cleanup();
  });

  it('frontmatter with name + description shows the SKILL badge', () => {
    const u = renderDoc('---\nname: my-skill\ndescription: does things\n---\n\nhello');
    expect(u.container.querySelector('.skill-meta-badge')).not.toBeNull();
    cleanup();
  });
});
