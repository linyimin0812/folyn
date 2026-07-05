import { describe, it, expect } from 'vitest';
import {
  computeDefaultPetPosition,
  PET_WINDOW_SIZE,
  PET_RIGHT_MARGIN,
  PET_BOTTOM_MARGIN,
  PET_MIN_TOP,
} from './petPosition';

describe('computeDefaultPetPosition', () => {
  it('places the pet at the bottom-right of the monitor (physical px)', () => {
    // 2880 physical px wide retina screen (scale 2 → 1440 logical).
    // The previous buggy code divided by scale and produced ~1300 (logical),
    // which Rust then interpreted as physical — placing the window mid-screen.
    const pos = computeDefaultPetPosition({ width: 2880, height: 1800 });
    const expectedX = 2880 - PET_WINDOW_SIZE - PET_RIGHT_MARGIN;
    const expectedY = 1800 - PET_WINDOW_SIZE - PET_BOTTOM_MARGIN;
    expect(pos.x).toBe(expectedX);
    expect(pos.y).toBe(expectedY);
  });

  it('uses a larger bottom margin than right margin so the Dock is cleared', () => {
    // R-F1 / AC1: the bottom margin must exceed the right margin so the
    // macOS Dock (~50–70px) does not occlude the mascot's lower portion.
    expect(PET_BOTTOM_MARGIN).toBeGreaterThan(PET_RIGHT_MARGIN);
    expect(PET_BOTTOM_MARGIN).toBeGreaterThanOrEqual(70);

    const pos = computeDefaultPetPosition({ width: 2880, height: 1800 });
    // The window's bottom edge must sit at least PET_BOTTOM_MARGIN above the
    // physical screen bottom (i.e. clear of the Dock).
    const bottomEdge = pos.y + PET_WINDOW_SIZE;
    expect(1800 - bottomEdge).toBe(PET_BOTTOM_MARGIN);
  });

  it('does NOT divide by scaleFactor (returns physical px, not logical)', () => {
    // Same physical size at different scales must produce the SAME position.
    // The function takes physical px only — there is no scale input.
    const a = computeDefaultPetPosition({ width: 2880, height: 1800 });
    const b = computeDefaultPetPosition({ width: 1440, height: 900 });
    // Independent of any scale: each monitor's own physical size is used.
    expect(a.x).toBe(2880 - PET_WINDOW_SIZE - PET_RIGHT_MARGIN);
    expect(b.x).toBe(1440 - PET_WINDOW_SIZE - PET_RIGHT_MARGIN);
  });

  it('clamps x to >= 0 so a tiny monitor cannot push it off-origin', () => {
    const pos = computeDefaultPetPosition({ width: 100, height: 1000 });
    expect(pos.x).toBe(0);
  });

  it('clamps y to >= PET_MIN_TOP so the menu bar never occludes the mascot', () => {
    // A monitor short enough that the bottom-margin calc would push the top
    // above the menu bar clamps to PET_MIN_TOP instead.
    const pos = computeDefaultPetPosition({ width: 2000, height: 100 });
    expect(pos.y).toBe(PET_MIN_TOP);
  });

  it('clamps a zero-sized monitor to {0, PET_MIN_TOP}', () => {
    const pos = computeDefaultPetPosition({ width: 0, height: 0 });
    expect(pos.x).toBe(0);
    expect(pos.y).toBe(PET_MIN_TOP);
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
