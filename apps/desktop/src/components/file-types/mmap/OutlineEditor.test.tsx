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

  it('Tab indents the focused row (depth 1 → 2)', () => {
    const src = '- Root\n  - A\n  - B';
    const { onChange } = setup(src);
    const tas = textareas();
    tas[1].focus();
    fireEvent.keyDown(tas[1], { key: 'Tab', shiftKey: false });
    const emitted = onChange.mock.calls[0][0] as string;
    expect(emitted).toBe('- Root\n    - A\n  - B');
  });

  it('Shift+Tab outdents the focused row (depth 2 → 1)', () => {
    const src = '- Root\n    - Child';
    const { onChange } = setup(src);
    const tas = textareas();
    tas[1].focus();
    fireEvent.keyDown(tas[1], { key: 'Tab', shiftKey: true });
    const emitted = onChange.mock.calls[0][0] as string;
    expect(emitted).toBe('- Root\n  - Child');
  });

  it('Shift+Tab on a depth-1 row is a no-op (cannot become a sibling of root)', () => {
    const src = '- Root\n  - Child';
    const { onChange } = setup(src);
    const tas = textareas();
    tas[1].focus();
    fireEvent.keyDown(tas[1], { key: 'Tab', shiftKey: true });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('Tab on the root (idx 0) is a no-op (root stays depth 0)', () => {
    const src = '- Root\n  - Child';
    const { onChange } = setup(src);
    const ta = textareas()[0];
    ta.focus();
    fireEvent.keyDown(ta, { key: 'Tab', shiftKey: false });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('Enter on root splits the row into a depth-1 child (not a depth-0 sibling)', () => {
    const src = '- RootNode';
    const { onChange } = setup(src);
    const ta = textareas()[0];
    ta.focus();
    ta.setSelectionRange(4, 4);
    fireEvent.keyDown(ta, { key: 'Enter' });
    const emitted = onChange.mock.calls[0][0] as string;
    // Root is unique — Enter creates a child so the new row gets a bullet.
    expect(emitted).toBe('- Root\n  - Node');
  });

  it('Backspace at caret 0 on a non-empty row merges with previous visible row', () => {
    const src = '- A\n- B';
    const { onChange } = setup(src);
    const ta = textareas()[1];
    ta.focus();
    ta.setSelectionRange(0, 0);
    fireEvent.keyDown(ta, { key: 'Backspace' });
    const emitted = onChange.mock.calls[0][0] as string;
    expect(emitted).toBe('- AB');
  });

  it('Backspace on an empty row deletes the row', () => {
    const src = '- A\n- ';
    const { onChange } = setup(src);
    const ta = textareas()[1];
    ta.focus();
    ta.setSelectionRange(0, 0);
    fireEvent.keyDown(ta, { key: 'Backspace' });
    const emitted = onChange.mock.calls[0][0] as string;
    expect(emitted).toBe('- A');
  });

  it('Backspace at caret 0 on root (no previous row) does not emit', () => {
    const src = '- Root';
    const { onChange } = setup(src);
    const ta = textareas()[0];
    ta.focus();
    ta.setSelectionRange(0, 0);
    fireEvent.keyDown(ta, { key: 'Backspace' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('Backspace mid-text does not intercept (no merge)', () => {
    const src = '- AB';
    const { onChange } = setup(src);
    const ta = textareas()[0];
    ta.focus();
    ta.setSelectionRange(1, 1);
    fireEvent.keyDown(ta, { key: 'Backspace' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('Shift+Enter inserts a newline that survives re-render (regression)', () => {
    // The textarea is controlled: value = text + ('\n' + note if note set).
    // Shift+Enter inserts `\n` → onChange fires with e.g. "Hello\n" →
    // updateLineText splits: text="Hello", note="" (empty string).
    // The value formula must use `note !== undefined` not truthy, or the
    // empty-string note strips the `\n` on re-render and Shift+Enter
    // appears to do nothing.
    const src = '- Hello';
    const { onChange } = setup(src);
    const ta = textareas()[0];
    ta.focus();
    ta.setSelectionRange(5, 5);
    // Simulate the browser's default Shift+Enter behavior: it inserts `\n`
    // into the textarea value, then fires `input`/`change`.
    fireEvent.change(ta, { target: { value: 'Hello\n' } });
    // Textarea value must still contain the newline after React re-renders.
    expect(ta.value).toBe('Hello\n');
    // Source serialization: an empty note emits no `> ` line (no noise), but
    // the in-memory textarea must keep the `\n` so the user can keep typing
    // into the note section.
    const emitted = onChange.mock.calls[0][0] as string;
    expect(emitted).toBe('- Hello');
    // Typing into the now-present note section appends to `note`, not `text`.
    fireEvent.change(ta, { target: { value: 'Hello\nWorld' } });
    expect(ta.value).toBe('Hello\nWorld');
  });
});

describe('OutlineEditor undo/redo', () => {
  afterEach(cleanup);

  // ponytail: Cmd+Z undoes the last edit. The native textarea undo stack
  // can't span structural edits (Enter split moves focus to a new row), so
  // the lines-level history must cover Enter. This test pins that.
  it('Cmd+Z undoes an Enter split (structural edit)', () => {
    const src = '- RootNode';
    const { onChange } = setup(src);
    const ta = textareas()[0];
    ta.focus();
    ta.setSelectionRange(4, 4);
    fireEvent.keyDown(ta, { key: 'Enter' });
    expect(onChange.mock.calls[0][0] as string).toBe('- Root\n  - Node');
    // Cmd+Z → undo the split → back to single row "- RootNode".
    fireEvent.keyDown(ta, { key: 'z', metaKey: true });
    expect(onChange.mock.calls[1][0] as string).toBe('- RootNode');
  });

  it('Cmd+Shift+Z redoes after an undo', () => {
    const src = '- RootNode';
    const { onChange } = setup(src);
    const ta = textareas()[0];
    ta.focus();
    ta.setSelectionRange(4, 4);
    fireEvent.keyDown(ta, { key: 'Enter' });
    fireEvent.keyDown(ta, { key: 'z', metaKey: true }); // undo
    fireEvent.keyDown(ta, { key: 'z', metaKey: true, shiftKey: true }); // redo
    expect(onChange.mock.calls[onChange.mock.calls.length - 1][0] as string).toBe(
      '- Root\n  - Node',
    );
  });

  it('Cmd+Z undoes a Tab indent (structural edit)', () => {
    const src = '- Root\n  - A';
    const { onChange } = setup(src);
    const ta = textareas()[1];
    ta.focus();
    fireEvent.keyDown(ta, { key: 'Tab' });
    expect(onChange.mock.calls[0][0] as string).toBe('- Root\n    - A');
    fireEvent.keyDown(ta, { key: 'z', metaKey: true });
    expect(onChange.mock.calls[1][0] as string).toBe('- Root\n  - A');
  });

  it('Cmd+Z with empty history is a no-op (no emit, no crash)', () => {
    const src = '- Root\n  - A';
    const { onChange } = setup(src);
    const ta = textareas()[0];
    ta.focus();
    fireEvent.keyDown(ta, { key: 'z', metaKey: true });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('Cmd+Y is an alias for redo', () => {
    const src = '- RootNode';
    const { onChange } = setup(src);
    const ta = textareas()[0];
    ta.focus();
    ta.setSelectionRange(4, 4);
    fireEvent.keyDown(ta, { key: 'Enter' });
    fireEvent.keyDown(ta, { key: 'z', metaKey: true }); // undo
    fireEvent.keyDown(ta, { key: 'y', metaKey: true }); // redo via Cmd+Y
    expect(onChange.mock.calls[onChange.mock.calls.length - 1][0] as string).toBe(
      '- Root\n  - Node',
    );
  });

  // ponytail: coalescing — consecutive text edits to the same row within
  // 500ms collapse into ONE undo step. Without coalescing, every keystroke
  // would be its own undo step, making the undo stack useless for typing.
  it('coalesces consecutive text edits to the same row into one undo step', () => {
    const src = '- abc';
    const { onChange } = setup(src);
    const ta = textareas()[0];
    ta.focus();
    ta.setSelectionRange(4, 4);
    fireEvent.change(ta, { target: { value: 'abcd' } });
    fireEvent.change(ta, { target: { value: 'abcde' } });
    // One Cmd+Z reverses both chars → back to "abc".
    fireEvent.keyDown(ta, { key: 'z', metaKey: true });
    expect(onChange.mock.calls[onChange.mock.calls.length - 1][0] as string).toBe(
      '- abc',
    );
  });
});
