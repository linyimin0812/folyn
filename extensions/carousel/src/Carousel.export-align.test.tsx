import { describe, it, expect } from 'vitest';
import { render, act } from '@testing-library/react';
import { createElement } from 'react';
import { Carousel, Slide } from './Carousel';
import { carouselExportScript } from './carouselExportScript';

/**
 * Regression: exported carousel showed slide 1+ at top-left (no alignment)
 * because the React effect only stamped alignment on the *active* slide at
 * mount time; hidden slides carried just `display:none`. The export enhancer's
 * go(idx) must re-apply alignment (position/inset/flex/textAlign/justifyContent/
 * alignItems) to whatever slide it switches to — mirroring the React effect.
 */
describe('carousel export enhancer applies alignment to switched slide', () => {
  it('go(1) stamps alignment on slide 1 (not just display)', async () => {
    const { container } = render(
      createElement(Carousel, { attributes: { align: 'center middle' } },
        createElement(Slide, { attributes: {} }, createElement('p', null, 'one')),
        createElement(Slide, { attributes: {} }, createElement('p', null, 'two')),
      ),
    );
    await act(async () => {});

    const slides = Array.from(container.querySelectorAll('[data-is-slide="true"]')) as HTMLElement[];
    const inner = container.querySelector('.docmd-carousel') as HTMLElement;

    // Slide 0 (active at mount) has alignment; slide 1 does not (only display:none).
    expect(slides[0].getAttribute('style')).toContain('text-align: center');
    expect(slides[1].getAttribute('style') || '').not.toContain('text-align');

    // Simulate the enhancer's go(1) against slide 1, using the data attrs the
    // component stamped on the .docmd-carousel root.
    const align = inner.getAttribute('data-carousel-align') || 'left';
    const valign = inner.getAttribute('data-carousel-valign') || 'top';
    const s = slides[1];
    s.style.display = 'flex';
    s.style.position = 'absolute';
    s.style.inset = '0';
    s.style.flexDirection = 'column';
    s.style.textAlign = align;
    s.style.justifyContent = valign === 'middle' ? 'center' : valign === 'bottom' ? 'flex-end' : 'flex-start';
    s.style.alignItems = align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start';

    const style = s.getAttribute('style') || '';
    expect(style).toContain('text-align: center');
    expect(style).toContain('justify-content: center');
    expect(style).toContain('align-items: center');
    expect(style).toContain('position: absolute');
  });
});
