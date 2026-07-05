import { describe, it, expect } from 'vitest';
import {
  computeDefaultPetPosition,
  clampPetPosition,
  PET_WINDOW_SIZE,
  PET_RIGHT_MARGIN,
  PET_BOTTOM_MARGIN,
  PET_MIN_TOP,
  type PetWorkArea,
} from './petPosition';

describe('computeDefaultPetPosition', () => {
  // NOTE: the function takes the **work area** size (post-Dock, post-menu-bar),
  // not the full monitor size. The Rust `pet_get_work_area` command returns
  // `NSScreen.visibleFrame` on macOS which already excludes the Dock and menu
  // bar, so the margins here are a small safety inset, not a Dock-clearance
  // buffer. The previous test values assumed full-monitor input and were
  // updated when the work-area rect was introduced.

  it('places the pet at the bottom-right of the work area (physical px)', () => {
    // 2880×1800 work area (retina 1440×900 with auto-hide Dock, full-screen).
    const pos = computeDefaultPetPosition({ width: 2880, height: 1800 });
    const expectedX = 2880 - PET_WINDOW_SIZE - PET_RIGHT_MARGIN;
    const expectedY = 1800 - PET_WINDOW_SIZE - PET_BOTTOM_MARGIN;
    expect(pos.x).toBe(expectedX);
    expect(pos.y).toBe(expectedY);
  });

  it('does NOT divide by scaleFactor (returns physical px, not logical)', () => {
    const a = computeDefaultPetPosition({ width: 2880, height: 1800 });
    const b = computeDefaultPetPosition({ width: 1440, height: 900 });
    expect(a.x).toBe(2880 - PET_WINDOW_SIZE - PET_RIGHT_MARGIN);
    expect(b.x).toBe(1440 - PET_WINDOW_SIZE - PET_RIGHT_MARGIN);
  });

  it('clamps x to >= 0 so a tiny work area cannot push it off-origin', () => {
    const pos = computeDefaultPetPosition({ width: 100, height: 1000 });
    expect(pos.x).toBe(0);
  });

  it('clamps y to >= PET_MIN_TOP so the menu bar never occludes the mascot', () => {
    const pos = computeDefaultPetPosition({ width: 2000, height: 100 });
    expect(pos.y).toBe(PET_MIN_TOP);
  });

  it('clamps a zero-sized work area to {0, PET_MIN_TOP}', () => {
    const pos = computeDefaultPetPosition({ width: 0, height: 0 });
    expect(pos.x).toBe(0);
    expect(pos.y).toBe(PET_MIN_TOP);
  });

  it('keeps the window fully inside the work area for a typical 1440x875 work area', () => {
    const pos = computeDefaultPetPosition({ width: 1440, height: 875 });
    expect(pos.x + PET_WINDOW_SIZE).toBeLessThanOrEqual(1440);
    expect(pos.y + PET_WINDOW_SIZE).toBeLessThanOrEqual(875);
    expect(pos.x).toBeGreaterThan(0);
    expect(pos.y).toBeGreaterThan(0);
  });
});

describe('clampPetPosition', () => {
  const workArea: PetWorkArea = { x: 0, y: 25, width: 1440, height: 875 };

  it('returns the saved position unchanged when it is already on-screen', () => {
    const pos = clampPetPosition({ x: 1300, y: 700 }, workArea);
    expect(pos).toEqual({ x: 1300, y: 700 });
  });

  it('clamps a position that is off the right edge', () => {
    // 2000 is beyond workArea.x + width - PET_WINDOW_SIZE = 1320.
    const pos = clampPetPosition({ x: 2000, y: 700 }, workArea);
    expect(pos.x).toBe(1440 - PET_WINDOW_SIZE);
    expect(pos.y).toBe(700);
  });

  it('clamps a position that is off the bottom edge', () => {
    const pos = clampPetPosition({ x: 1300, y: 99999 }, workArea);
    expect(pos.y).toBe(25 + 875 - PET_WINDOW_SIZE);
    expect(pos.x).toBe(1300);
  });

  it('clamps a position that is off the top edge (negative y)', () => {
    const pos = clampPetPosition({ x: 1300, y: -100 }, workArea);
    expect(pos.y).toBe(25);
    expect(pos.x).toBe(1300);
  });

  it('clamps a position that is off the left edge (negative x)', () => {
    const pos = clampPetPosition({ x: -50, y: 700 }, workArea);
    expect(pos.x).toBe(0);
    expect(pos.y).toBe(700);
  });

  it('handles a work area smaller than the pet window (degenerate)', () => {
    const tiny: PetWorkArea = { x: 0, y: 0, width: 50, height: 50 };
    const pos = clampPetPosition({ x: 1000, y: 1000 }, tiny);
    // The pet is anchored at the work area's top-left; the window overflows
    // but the anchor stays on-screen.
    expect(pos).toEqual({ x: 0, y: 0 });
  });

  it('respects a non-zero work-area origin', () => {
    const shifted: PetWorkArea = { x: 100, y: 100, width: 1000, height: 700 };
    const pos = clampPetPosition({ x: 5000, y: 5000 }, shifted);
    expect(pos.x).toBe(100 + 1000 - PET_WINDOW_SIZE);
    expect(pos.y).toBe(100 + 700 - PET_WINDOW_SIZE);
  });
});
