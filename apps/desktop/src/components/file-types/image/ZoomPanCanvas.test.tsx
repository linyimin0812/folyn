// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, fireEvent, screen, cleanup } from '@testing-library/react';
import { ZoomPanCanvas } from './ZoomPanCanvas';

function load(img: HTMLImageElement, w: number, h: number) {
  Object.defineProperty(img, 'naturalWidth', { configurable: true, value: w });
  Object.defineProperty(img, 'naturalHeight', { configurable: true, value: h });
  fireEvent.load(img);
}

function sizeCanvas(container: HTMLElement, w: number, h: number) {
  const canvas = container.querySelector('.image-viewer-canvas') as HTMLElement;
  Object.defineProperty(canvas, 'clientWidth', { configurable: true, value: w });
  Object.defineProperty(canvas, 'clientHeight', { configurable: true, value: h });
}

const pct = () => screen.getByText(/%$/).textContent;

describe('ZoomPanCanvas', () => {
  afterEach(cleanup);

  it('shows a large image at natural size (1:1) by default', () => {
    const { container } = render(<ZoomPanCanvas src="a.svg" alt="a" />);
    sizeCanvas(container, 660, 400);
    const img = container.querySelector('img')!;
    load(img, 1320, 480);
    expect(pct()).toBe('100%');
    expect(img.className).toContain('max-w-none');
    expect(img.className).not.toContain('object-contain');
  });

  it('Fit shrinks a large image to the pane and 1:1 restores natural size', () => {
    const { container } = render(<ZoomPanCanvas src="a.svg" alt="a" />);
    sizeCanvas(container, 660, 400);
    load(container.querySelector('img')!, 1320, 480);
    fireEvent.click(screen.getByTitle('Fit to window'));
    expect(pct()).toBe('50%');
    fireEvent.click(screen.getByTitle('Actual size'));
    expect(pct()).toBe('100%');
  });

  it('Fit never upscales a small image; double-click toggles 1:1 and fit', () => {
    const { container } = render(<ZoomPanCanvas src="a.png" alt="a" />);
    sizeCanvas(container, 660, 400);
    load(container.querySelector('img')!, 100, 50);
    fireEvent.click(screen.getByTitle('Fit to window'));
    expect(pct()).toBe('100%');

    const canvas = container.querySelector('.image-viewer-canvas')!;
    load(container.querySelector('img')!, 1320, 480);
    fireEvent.doubleClick(canvas);
    expect(pct()).toBe('50%');
    fireEvent.doubleClick(canvas);
    expect(pct()).toBe('100%');
  });

  it('initialFit opens fitted to the pane, upscaling allowed', () => {
    const { container } = render(<ZoomPanCanvas src="m.svg" alt="m" initialFit />);
    sizeCanvas(container, 600, 400);
    load(container.querySelector('img')!, 300, 150);
    expect(pct()).toBe('200%');
  });

  it('falls back to object-contain fit when the natural size is unknown', () => {
    const { container } = render(<ZoomPanCanvas src="v.svg" alt="v" />);
    const img = container.querySelector('img')!;
    load(img, 0, 0);
    expect(img.className).toContain('object-contain');
  });
});
