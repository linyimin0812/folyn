import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, fireEvent } from '@testing-library/react';
import { createElement } from 'react';
import { ResizableMedia } from './ResizableMedia';

// jsdom has no layout engine: the fit math (clientWidth/scrollWidth) would be
// all zeros, so mock the refs' dimensions via element stubs is overkill —
// instead assert the interaction contract: click serializes the SVG and opens
// the lightbox; Esc closes it. DiagramLightbox's zoom math is pure state math
// not observable under jsdom, so we assert on rendering only.

function renderMedia(kind: 'img' | 'fence', inner: string) {
  const contentRef = { current: 'source' };
  const onChangeRef = { current: undefined as ((c: string) => void) | undefined };
  return render(
    createElement(
      ResizableMedia,
      { kind, sourceLine: 3, contentRef, onChangeRef },
      createElement('div', { dangerouslySetInnerHTML: { __html: inner } }),
    ),
  );
}

describe('ResizableMedia fence click → DiagramLightbox', () => {
  afterEach(() => cleanup());

  it('clicking a rendered SVG opens the fullscreen lightbox with serialized markup', () => {
    renderMedia('fence', '<svg viewBox="0 0 40 20"><rect width="40" height="20" fill="red"></rect></svg>');

    // Before click: no lightbox.
    expect(document.querySelector('.diagram-lightbox')).toBeNull();

    fireEvent.click(document.querySelector('.resizable-media svg')!);
    const lb = document.querySelector('.diagram-lightbox');
    expect(lb).not.toBeNull();
    // The serialized SVG was cloned into the lightbox (dangerouslySetInnerHTML).
    expect(lb!.querySelector('svg rect')?.getAttribute('fill')).toBe('red');
  });

  it('clicks on the resize handle do NOT open the lightbox', () => {
    renderMedia('fence', '<svg></svg>');
    fireEvent.click(document.querySelector('.resize-handle')!);
    expect(document.querySelector('.diagram-lightbox')).toBeNull();
  });

  it('img kind never opens the diagram lightbox', () => {
    renderMedia('img', '<img />');
    fireEvent.click(document.querySelector('.resizable-media img')!);
    expect(document.querySelector('.diagram-lightbox')).toBeNull();
  });

  it('Esc closes the lightbox', () => {
    renderMedia('fence', '<svg><rect></rect></svg>');
    fireEvent.click(document.querySelector('.resizable-media svg')!);
    expect(document.querySelector('.diagram-lightbox')).not.toBeNull();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(document.querySelector('.diagram-lightbox')).toBeNull();
  });
});
