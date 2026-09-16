import { describe, it, expect } from 'vitest';
import { render, act } from '@testing-library/react';
import { Carousel, Slide } from './Carousel';

/**
 * Regression: the host's DirectiveWrapper wraps :::slide in a
 * <div data-container="slide"> around the Slide component. The direct
 * Carousel.test.tsx renders Slide as a direct child (no wrapper), so it
 * missed the bug where the slide's absolute positioning resolved against the
 * wrong ancestor. This test mirrors the real nesting.
 */
describe('Carousel with DirectiveWrapper nesting', () => {
  it('viewport is the positioning context + slide fills it + centering set', async () => {
    const { container } = render(
      <Carousel attributes={{ interval: '0', height: '200px', align: 'center middle' }}>
        <div data-container="slide" data-source-line="1">
          <Slide><p>x</p></Slide>
        </div>
      </Carousel>,
    );
    await act(async () => {});

    const viewport = container.querySelector('.docmd-carousel > div') as HTMLElement;
    expect(viewport.style.position).toBe('relative');

    const slide = container.querySelector('[data-is-slide="true"]') as HTMLElement;
    expect(slide.style.position).toBe('absolute');
    expect(slide.style.inset).toBe('0');
    expect(slide.style.justifyContent).toBe('center'); // vertical middle
    expect(slide.style.alignItems).toBe('center');     // horizontal center
  });
});
