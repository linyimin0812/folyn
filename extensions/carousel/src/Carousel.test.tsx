import { describe, it, expect } from 'vitest';
import { render, act } from '@testing-library/react';
import { Carousel, Slide } from './Carousel';

describe('Carousel', () => {
  it('shows only the first slide on mount and reveals dots + arrows', async () => {
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

    expect(container.querySelectorAll('button[aria-label="Previous"]')).toHaveLength(1);
    expect(container.querySelectorAll('button[aria-label="Next"]')).toHaveLength(1);
    expect(container.querySelectorAll('button[title^="Slide"]')).toHaveLength(3);
  });

  it('advances to the next slide when Next is clicked', async () => {
    const { container } = render(
      <Carousel>
        <Slide><p>一</p></Slide>
        <Slide><p>二</p></Slide>
      </Carousel>,
    );
    await act(async () => {});
    const next = container.querySelector('button[aria-label="Next"]') as HTMLButtonElement;
    await act(async () => { next.click(); });
    const slides = Array.from(container.querySelectorAll('[data-is-slide="true"]'));
    const visible = slides.filter((el) => (el as HTMLElement).style.display !== 'none');
    expect(visible).toHaveLength(1);
    expect(visible[0].textContent).toContain('二');
  });
});
