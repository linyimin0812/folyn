import { describe, it, expect } from 'vitest';
import {
  computeDefaultPetPosition,
  PET_WINDOW_SIZE,
  PET_DEFAULT_MARGIN,
} from './petPosition';

describe('computeDefaultPetPosition', () => {
  it('places the pet at the bottom-right of the monitor (physical px)', () => {
    // 2880 physical px wide retina screen (scale 2 → 1440 logical).
    // The previous buggy code divided by scale and produced ~1300 (logical),
    // which Rust then interpreted as physical — placing the window mid-screen.
    const pos = computeDefaultPetPosition({ width: 2880, height: 1800 });
    const expectedX = 2880 - PET_WINDOW_SIZE - PET_DEFAULT_MARGIN;
    const expectedY = 1800 - PET_WINDOW_SIZE - PET_DEFAULT_MARGIN;
    expect(pos.x).toBe(expectedX);
    expect(pos.y).toBe(expectedY);
  });

  it('does NOT divide by scaleFactor (returns physical px, not logical)', () => {
    // Same physical size at different scales must produce the SAME position.
    // The function takes physical px only — there is no scale input.
    const a = computeDefaultPetPosition({ width: 2880, height: 1800 });
    const b = computeDefaultPetPosition({ width: 1440, height: 900 });
    // Independent of any scale: each monitor's own physical size is used.
    expect(a.x).toBe(2880 - PET_WINDOW_SIZE - PET_DEFAULT_MARGIN);
    expect(b.x).toBe(1440 - PET_WINDOW_SIZE - PET_DEFAULT_MARGIN);
  });

  it('clamps x and y to >= 0 so a tiny monitor cannot push it off-origin', () => {
    const pos = computeDefaultPetPosition({ width: 100, height: 80 });
    expect(pos.x).toBe(0);
    expect(pos.y).toBe(0);
  });

  it('clamps a zero-sized monitor to {0, 0}', () => {
    const pos = computeDefaultPetPosition({ width: 0, height: 0 });
    expect(pos.x).toBe(0);
    expect(pos.y).toBe(0);
  });

  it('keeps the window fully on-screen for a typical 1440x900 monitor', () => {
    const pos = computeDefaultPetPosition({ width: 1440, height: 900 });
    // The pet window's top-left plus its footprint must not exceed the
    // monitor bounds.
    expect(pos.x + PET_WINDOW_SIZE).toBeLessThanOrEqual(1440);
    expect(pos.y + PET_WINDOW_SIZE).toBeLessThanOrEqual(900);
    expect(pos.x).toBeGreaterThan(0);
    expect(pos.y).toBeGreaterThan(0);
  });
});
