import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

// jsdom does not implement Element.scrollIntoView; polyfill before any render.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() { /* no-op */ };
}

import { MessageContent } from './MessageContent';

beforeEach(() => { cleanup(); });
afterEach(() => { cleanup(); });

describe('MessageContent', () => {
  it('plaintext mode renders raw text inside a plain div', () => {
    const { container } = render(<MessageContent content={'line1\nline2'} plaintext className="whitespace-pre-wrap" />);
    const div = container.firstChild as HTMLElement;
    expect(div).toBeTruthy();
    expect(div.tagName).toBe('DIV');
    expect(div.textContent).toBe('line1\nline2');
    // no markdown processing — no <strong>, <p>, etc.
    expect(container.querySelector('strong')).toBeNull();
    expect(container.querySelector('p')).toBeNull();
    expect(div.className).toContain('whitespace-pre-wrap');
  });

  it('markdown mode renders the pipeline output (smoke: **bold** → <strong>)', () => {
    const { container } = render(<MessageContent content="**bold**" />);
    // .msg-md wrapper present
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.tagName).toBe('DIV');
    expect(wrapper.className).toContain('msg-md');
    // bold → <strong>
    const strong = container.querySelector('strong');
    expect(strong).toBeTruthy();
    expect(strong?.textContent).toBe('bold');
  });

  it('markdown mode: empty/whitespace content renders null (no children)', () => {
    const { container } = render(<MessageContent content="   " />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper).toBeTruthy();
    expect(wrapper.className).toContain('msg-md');
    // null rendered result → no child nodes inside the wrapper
    expect(wrapper.childNodes.length).toBe(0);
  });

  it('plaintext mode: empty content still renders the wrapper div (caller decides visibility)', () => {
    const { container } = render(<MessageContent content="" plaintext />);
    const div = container.firstChild as HTMLElement;
    expect(div).toBeTruthy();
    expect(div.tagName).toBe('DIV');
    expect(div.textContent).toBe('');
  });

  it('markdown mode: content that is a single data:image base64 URL renders as <img>', () => {
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKU=';
    const { container } = render(<MessageContent content={dataUrl} />);
    const img = container.querySelector('img');
    expect(img).toBeTruthy();
    expect(img?.getAttribute('src')).toBe(dataUrl);
  });

  it('markdown mode: throws inside the processor fall back to raw content', async () => {
    // Force the unified processor to throw by mocking `unified`. The
    // processor is built at module-eval time, so we mock `unified` itself
    // and re-import the component. vi.doMock + vi.resetModules lets us
    // scope the mock to this test only (other tests keep the real pipeline).
    vi.resetModules();
    vi.doMock('unified', async () => {
      const actual = await vi.importActual<typeof import('unified')>('unified');
      return {
        ...actual,
        unified: () => ({
          use: function () { return this; },
          processSync: () => { throw new Error('boom'); },
        }),
      };
    });
    const { MessageContent: Throwing } = await import('./MessageContent');
    const { container } = render(<Throwing content="hello" />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper).toBeTruthy();
    // fallback: raw content string rendered as a text node
    expect(wrapper.textContent).toBe('hello');
    vi.doUnmock('unified');
    vi.resetModules();
  });
});
