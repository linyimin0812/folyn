import { describe, it, expect } from 'vitest';
import { capWheelFactor } from './usePreviewZoom';
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
