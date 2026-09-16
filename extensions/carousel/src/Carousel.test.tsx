import { describe, it, expect, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { Carousel, Slide } from './Carousel';

describe('Carousel', () => {
  it('shows only the first slide on mount and reveals dots (no arrows)', async () => {
    const { container } = render(
      <Carousel>
        <Slide><p>第一张</p></Slide>
        <Slide><p>第二张</p></Slide>
        <Slide><p>第三张</p></Slide>
      </Carousel>,
    );
    await act(async () => {});

    const slides = Array.from(container.querySelectorAll('[data-is-slide="true"]'));
    expect(slides).toHaveLength(3);

    const visible = slides.filter((el) => (el as HTMLElement).style.display !== 'none');
    console.log('VISIBLE COUNT:', visible.length, 'display values:', slides.map((e) => (e as HTMLElement).style.display));
    expect(visible).toHaveLength(1);
    expect(visible[0].textContent).toContain('第一张');

    expect(container.querySelectorAll('button[title^="Slide"]')).toHaveLength(3);
    // No prev/next arrows (removed per UX — dots only).
    expect(container.querySelectorAll('button[aria-label="Previous"]')).toHaveLength(0);
    expect(container.querySelectorAll('button[aria-label="Next"]')).toHaveLength(0);
  });

  it('advances to the second slide when its dot is clicked', async () => {
    const { container } = render(
      <Carousel>
        <Slide><p>一</p></Slide>
        <Slide><p>二</p></Slide>
      </Carousel>,
    );
    await act(async () => {});
    const dots = container.querySelectorAll('button[title^="Slide"]');
    await act(async () => { (dots[1] as HTMLButtonElement).click(); });
    const slides = Array.from(container.querySelectorAll('[data-is-slide="true"]'));
    const visible = slides.filter((el) => (el as HTMLElement).style.display !== 'none');
    expect(visible).toHaveLength(1);
    expect(visible[0].textContent).toContain('二');
  });

  it('applies an explicit height to the viewport', async () => {
    const { container } = render(
      <Carousel attributes={{ interval: '0', height: '200px' }}>
        <Slide><p>x</p></Slide>
      </Carousel>,
    );
    await act(async () => {});
    const viewport = container.querySelector('.docmd-carousel > div') as HTMLElement;
    expect(viewport.style.height).toBe('200px');
  });

  it('autoplays when interval>0 and autoplay is not "false"', async () => {
    vi.useFakeTimers();
    try {
      const { container } = render(
        <Carousel attributes={{ interval: '1' }}>
          <Slide><p>一</p></Slide>
          <Slide><p>二</p></Slide>
        </Carousel>,
      );
      await act(async () => {});
      let visible = Array.from(container.querySelectorAll('[data-is-slide="true"]'))
        .filter((el) => (el as HTMLElement).style.display !== 'none');
      expect(visible[0].textContent).toContain('一');
      await act(async () => { vi.advanceTimersByTime(1000); });
      visible = Array.from(container.querySelectorAll('[data-is-slide="true"]'))
        .filter((el) => (el as HTMLElement).style.display !== 'none');
      expect(visible[0].textContent).toContain('二');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does NOT autoplay when autoplay="false"', async () => {
    vi.useFakeTimers();
    try {
      const { container } = render(
        <Carousel attributes={{ interval: '1', autoplay: 'false' }}>
          <Slide><p>一</p></Slide>
          <Slide><p>二</p></Slide>
        </Carousel>,
      );
      await act(async () => {});
      await act(async () => { vi.advanceTimersByTime(5000); });
      const visible = Array.from(container.querySelectorAll('[data-is-slide="true"]'))
        .filter((el) => (el as HTMLElement).style.display !== 'none');
      expect(visible).toHaveLength(1);
      expect(visible[0].textContent).toContain('一');
    } finally {
      vi.useRealTimers();
    }
  });

  it('centers slide content horizontally + vertically with align="center middle"', async () => {
    const { container } = render(
      <Carousel attributes={{ interval: '0', height: '200px', align: 'center middle' }}>
        <Slide><p>x</p></Slide>
      </Carousel>,
    );
    await act(async () => {});
    const slide = container.querySelector('[data-is-slide="true"]') as HTMLElement;
    // Stretches to fill the viewport (so vertical centering has room).
    expect(slide.style.flex).toBe('1 1 0%');
    expect(slide.style.justifyContent).toBe('center'); // vertical middle
    expect(slide.style.alignItems).toBe('center');     // horizontal center
  });
});
