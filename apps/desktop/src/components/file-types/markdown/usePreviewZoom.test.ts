import { describe, it, expect } from 'vitest';
import { compensateScroll, capWheelFactor } from './usePreviewZoom';
import { clampMdPreviewZoom, MD_PREVIEW_ZOOM_MIN, MD_PREVIEW_ZOOM_MAX } from '@/store/appearanceStore';

describe('clampMdPreviewZoom', () => {
  it('clamps to [0.5, 3] and guards NaN', () => {
    expect(clampMdPreviewZoom(0.1)).toBe(MD_PREVIEW_ZOOM_MIN);
    expect(clampMdPreviewZoom(99)).toBe(MD_PREVIEW_ZOOM_MAX);
    expect(clampMdPreviewZoom(1.25)).toBe(1.25);
    expect(clampMdPreviewZoom(NaN)).toBe(1);
  });
});

describe('capWheelFactor', () => {
  it('caps mouse-detent jumps but passes trackpad-scale factors', () => {
    expect(capWheelFactor(Math.exp(-120 * 0.01))).toBe(1 / 1.15);
    expect(capWheelFactor(Math.exp(120 * 0.01))).toBe(1.15);
    expect(capWheelFactor(Math.exp(-3 * 0.01))).toBeCloseTo(Math.exp(-0.03), 10);
    expect(capWheelFactor(1)).toBe(1);
  });
});

describe('compensateScroll', () => {
  it('keeps the anchor content point fixed under zoom', () => {
    // zoom 1 → 2, anchor 100px from viewport top, scrolled 200px:
    // content point = 200 + 100 = 300; at 2x it sits at 600 − 100 = 500
    expect(compensateScroll(200, 100, 2)).toBe(500);
  });

  it('is the inverse when zooming back', () => {
    const once = compensateScroll(200, 100, 2);
    expect(compensateScroll(once, 100, 0.5)).toBe(200);
  });

  it('leaves scroll unchanged at ratio 1 and anchor 0 scroll 0', () => {
    expect(compensateScroll(0, 0, 1.5)).toBe(0);
    expect(compensateScroll(123, 45, 1)).toBe(123);
  });
});
