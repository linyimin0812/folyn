// @vitest-environment jsdom
/**
 * OutlineEditor — keyboard interaction tests.
 *
 * Covers the minimum WorkFlowy contract: Tab indents, Shift+Tab outdents,
 * Enter splits at cursor. Fold/arrow-nav are deferred (see `ponytail:`
 * comments in OutlineEditor.tsx).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { OutlineEditor } from './OutlineEditor';

function setup(initialContent: string) {
  const onChange = vi.fn();
  render(
    <OutlineEditor
      content={initialContent}
      tabId="t"
      filePath="t.mmap"
      onSave={() => {}}
      onChange={onChange}
    />,
  );
  return { onChange };
}

function textareas(): HTMLTextAreaElement[] {
  return Array.from(document.querySelectorAll('textarea'));
}

describe('OutlineEditor keyboard', () => {
  afterEach(cleanup);

  it('Tab indents the focused row (depth 0 → 1)', () => {
    const src = '- Root\n  - A\n  - B';
    const { onChange } = setup(src);
    const tas = textareas();
    tas[1].focus();
    fireEvent.keyDown(tas[1], { key: 'Tab', shiftKey: false });
    const emitted = onChange.mock.calls[0][0] as string;
    expect(emitted).toBe('- Root\n    - A\n  - B');
  });

  it('Shift+Tab outdents the focused row (depth 1 → 0)', () => {
    const src = '- Root\n  - Child';
    const { onChange } = setup(src);
    const tas = textareas();
    tas[1].focus();
    fireEvent.keyDown(tas[1], { key: 'Tab', shiftKey: true });
    const emitted = onChange.mock.calls[0][0] as string;
    expect(emitted).toBe('- Root\n- Child');
  });

  it('Enter splits the focused row at the cursor position', () => {
    const src = '- RootNode';
    const { onChange } = setup(src);
    const ta = textareas()[0];
    ta.focus();
    ta.setSelectionRange(4, 4);
    fireEvent.keyDown(ta, { key: 'Enter' });
    const emitted = onChange.mock.calls[0][0] as string;
    expect(emitted).toBe('- Root\n- Node');
  });
});
