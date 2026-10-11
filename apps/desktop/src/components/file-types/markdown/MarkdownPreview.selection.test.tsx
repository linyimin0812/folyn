// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';

vi.mock('../excalidraw/ExcalidrawPreview', () => ({ ExcalidrawPreview: () => null }));
vi.mock('@/components/file-types/registry', () => ({
  getHandlerByExtension: () => null,
  getHandlerById: () => null,
  getModeComponent: () => null,
}));
vi.mock('@/store/aiConfigStore', () => ({ useAiConfigStore: () => ({}) }));

import { MarkdownPreview } from './MarkdownPreview';

afterEach(() => {
  cleanup();
  window.getSelection()?.removeAllRanges();
  Reflect.deleteProperty(Range.prototype, 'expand');
  Reflect.deleteProperty(document, 'caretRangeFromPoint');
  Reflect.deleteProperty(Range.prototype, 'getClientRects');
  vi.restoreAllMocks();
});

function preview(text = 'Read technical documentation.') {
  const view = render(<MarkdownPreview content={text} filePath="note.md" vaultRoot="" />);
  const root = view.container.querySelector('.md-preview')!;
  const paragraph = root.querySelector('p')!;
  const node = paragraph.firstChild!;
  const caret = document.createRange();
  caret.setStart(node, node.textContent!.indexOf('technical') + 3);
  caret.collapse(true);
  Object.defineProperty(document, 'caretRangeFromPoint', {
    configurable: true,
    value: () => caret.cloneRange(),
  });
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] });
  return { ...view, root, paragraph, node };
}

describe('MarkdownPreview word selection', () => {
  it('selects the clicked word even when WebKit word expansion resolves to a newline', () => {
    const { paragraph } = preview();
    const newline = document.createTextNode('\n');
    paragraph.appendChild(newline);
    // Replay the native expansion result captured in folyn-dbl-debug.log.
    // jsdom has no WebKit word expansion or physical mouse input pipeline.
    Object.defineProperty(Range.prototype, 'expand', {
      configurable: true,
      value(this: Range) {
        this.setStart(newline, 0);
        this.setEnd(newline, 1);
      },
    });
    fireEvent.mouseDown(paragraph, { button: 0, detail: 2 });
    fireEvent.mouseUp(paragraph, { button: 0, detail: 2 });
    expect(window.getSelection()?.toString()).toBe('technical');
  });

  it('corrects native selection changes after mouseup, then releases the gesture', () => {
    let frame: FrameRequestCallback | undefined;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { frame = callback; return 1; });
    const { paragraph } = preview();
    fireEvent.mouseDown(paragraph, { button: 0, detail: 2 });
    fireEvent.mouseUp(paragraph, { button: 0, detail: 2 });
    const whole = document.createRange();
    whole.selectNodeContents(paragraph);
    const selectWhole = () => {
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(whole.cloneRange());
      fireEvent(document, new Event('selectionchange'));
    };
    selectWhole();
    expect(window.getSelection()?.toString()).toBe('technical');
    frame!(0);
    selectWhole();
    expect(window.getSelection()?.toString()).toBe(paragraph.textContent);
  });

  it.each([1, 3])('preserves native click detail %i and cancels the previous word lock', (detail) => {
    const { paragraph } = preview();
    fireEvent.mouseDown(paragraph, { button: 0, detail: 2 });
    const next = new MouseEvent('mousedown', { button: 0, detail, bubbles: true, cancelable: true });
    paragraph.dispatchEvent(next);
    expect(next.defaultPrevented).toBe(false);
    const whole = document.createRange();
    whole.selectNodeContents(paragraph);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(whole);
    fireEvent(document, new Event('selectionchange'));
    expect(window.getSelection()?.toString()).toBe(paragraph.textContent);
  });

  it('joins a word across inline formatting', () => {
    const { paragraph } = preview('Read technical documentation.');
    paragraph.innerHTML = 'Read <strong>tech</strong>nical documentation.';
    const caret = document.createRange();
    caret.setStart(paragraph.querySelector('strong')!.firstChild!, 2);
    caret.collapse(true);
    Object.defineProperty(document, 'caretRangeFromPoint', { configurable: true, value: () => caret.cloneRange() });
    fireEvent.mouseDown(paragraph, { button: 0, detail: 2 });
    expect(window.getSelection()?.toString()).toBe('technical');
  });

  it('selects one Chinese word', () => {
    const { paragraph } = preview();
    paragraph.textContent = '今天去公园看看风景。';
    const caret = document.createRange();
    caret.setStart(paragraph.firstChild!, 4);
    caret.collapse(true);
    Object.defineProperty(document, 'caretRangeFromPoint', { configurable: true, value: () => caret.cloneRange() });
    fireEvent.mouseDown(paragraph, { button: 0, detail: 2 });
    expect(window.getSelection()?.toString()).toBe('公园');
  });

  it('does not intercept preview controls or a caret outside this preview', () => {
    const { paragraph, root } = preview();
    const button = document.createElement('button');
    button.textContent = 'Control';
    root.appendChild(button);
    const event = new MouseEvent('mousedown', { button: 0, detail: 2, bubbles: true, cancelable: true });
    button.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(window.getSelection()?.toString()).toBe('');
    const external = document.createTextNode('outside');
    document.body.appendChild(external);
    const caret = document.createRange();
    caret.setStart(external, 3);
    caret.collapse(true);
    Object.defineProperty(document, 'caretRangeFromPoint', { configurable: true, value: () => caret.cloneRange() });
    fireEvent.mouseDown(paragraph, { button: 0, detail: 2 });
    expect(window.getSelection()?.toString()).toBe('');
    external.remove();
  });

  it('cleans up the pending gesture when the preview unmounts', () => {
    const { paragraph, unmount } = preview();
    fireEvent.mouseDown(paragraph, { button: 0, detail: 2 });
    unmount();
    window.getSelection()?.removeAllRanges();
    fireEvent(document, new Event('selectionchange'));
    expect(window.getSelection()?.toString()).toBe('');
  });
});
