/**
 * Tests for IconFromSvg: size injection on the raw SVG string.
 */

import { describe, it, expect } from 'vitest';
import { normalizeSvg, IconFromSvg } from './IconFromSvg';
import { render } from '@testing-library/react';

describe('normalizeSvg', () => {
  it('replaces existing width/height', () => {
    const out = normalizeSvg('<svg width="8" height="8"></svg>', 16);
    expect(out).toBe('<svg width="16" height="16"></svg>');
  });

  it('injects width/height when absent', () => {
    const out = normalizeSvg('<svg><circle/></svg>', 14);
    // width injected first (matches ThemeIcon.normalizeSvg order), then height
    // rewrites the `<svg` tag, producing height-before-width — stable contract.
    expect(out).toBe('<svg height="14" width="14"><circle/></svg>');
  });

  it('only touches the first width/height occurrences (no viewBox rewrite)', () => {
    const out = normalizeSvg('<svg width="8" height="8" viewBox="0 0 8 8"></svg>', 20);
    expect(out).toBe('<svg width="20" height="20" viewBox="0 0 8 8"></svg>');
  });

  it('strips width/height from inline style (CSS overrides SVG attributes)', () => {
    const out = normalizeSvg(
      '<svg viewBox="0 0 32 32" style="width: 200px; height: 200px; transform: rotate(0deg);"></svg>',
      20,
    );
    expect(out).toBe(
      '<svg height="20" width="20" viewBox="0 0 32 32" style="transform: rotate(0deg);"></svg>',
    );
  });

  it('drops the style attribute entirely when only width/height remained', () => {
    const out = normalizeSvg('<svg style="width:200px;height:200px"></svg>', 16);
    expect(out).toBe('<svg height="16" width="16"></svg>');
  });
});

describe('IconFromSvg', () => {
  it('renders a span with dangerouslySetInnerHTML containing the normalized svg', () => {
    const { container } = render(<IconFromSvg svg="<svg><circle/></svg>" size={12} />);
    const span = container.querySelector('span');
    expect(span).not.toBeNull();
    expect(span!.innerHTML).toContain('width="12"');
    expect(span!.innerHTML).toContain('height="12"');
    // size applied to the wrapper span
    expect(span!.style.width).toBe('12px');
    expect(span!.style.height).toBe('12px');
  });

  it('applies className to the wrapper span', () => {
    const { container } = render(
      <IconFromSvg svg="<svg/>" size={16} className="my-icon" />,
    );
    expect(container.querySelector('span')?.className).toContain('my-icon');
  });

  it('defaults size to 16', () => {
    const { container } = render(<IconFromSvg svg="<svg/>" />);
    const span = container.querySelector('span')!;
    expect(span.innerHTML).toContain('width="16"');
  });
});
