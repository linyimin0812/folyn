import { describe, expect, it } from 'vitest';
import { getMaxMediaWidth, getResizedMediaWidth } from './mediaResize';

describe('getResizedMediaWidth', () => {
  it('does not grow media that already fills its container', () => {
    expect(getResizedMediaWidth(500, 100, 500)).toBe(500);
  });

  it('clamps growth to the container width', () => {
    expect(getResizedMediaWidth(450, 100, 500)).toBe(500);
  });

  it('allows shrinking below the container width', () => {
    expect(getResizedMediaWidth(500, -100, 500)).toBe(400);
  });
});

describe('getMaxMediaWidth', () => {
  it('uses the visible Markdown preview width when a paragraph overflows it', () => {
    expect(getMaxMediaWidth(900, 500)).toBe(500);
  });
});
