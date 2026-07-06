import { describe, it, expect } from 'vitest';
import {
  computeDefaultPetPosition,
  clampPetPosition,
  computePanelPosition,
  clampPanelPosition,
  clampPanelSize,
  PET_WINDOW_SIZE,
  PET_RIGHT_MARGIN,
  PET_BOTTOM_MARGIN,
  PET_MIN_TOP,
  PET_PANEL_WIDTH,
  PET_PANEL_HEIGHT,
  PET_PANEL_MIN_WIDTH,
  PET_PANEL_MIN_HEIGHT,
  PET_PANEL_GAP,
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

describe('computePanelPosition', () => {
  const workArea: PetWorkArea = { x: 0, y: 25, width: 1440, height: 875 };

  it('opens the panel ABOVE the pet when there is room above', () => {
    // Pet low enough that there is >= PET_PANEL_HEIGHT+gap room above it
    // (workArea.y=25, so petY must be >= 25 + 520 + 8 = 553).
    const pos = computePanelPosition({ x: 600, y: 600 }, workArea);
    expect(pos.y).toBe(600 - PET_PANEL_GAP - PET_PANEL_HEIGHT);
    // X is centered on the pet.
    expect(pos.x).toBe(600 + (PET_WINDOW_SIZE - PET_PANEL_WIDTH) / 2);
    // Whole panel inside the work area.
    expect(pos.x + PET_PANEL_WIDTH).toBeLessThanOrEqual(workArea.x + workArea.width);
    expect(pos.y + PET_PANEL_HEIGHT).toBeLessThanOrEqual(workArea.y + workArea.height);
  });

  it('opens the panel BELOW the pet when the pet is near the top edge', () => {
    // Pet near top: not enough room above → opens below (panel top = pet bottom + gap).
    const petY = workArea.y + 10;
    const pos = computePanelPosition({ x: 600, y: petY }, workArea);
    expect(pos.y).toBe(petY + PET_WINDOW_SIZE + PET_PANEL_GAP);
    expect(pos.x).toBe(600 + (PET_WINDOW_SIZE - PET_PANEL_WIDTH) / 2);
    expect(pos.y + PET_PANEL_HEIGHT).toBeLessThanOrEqual(workArea.y + workArea.height);
  });

  it('centers the panel on the pet X, clamped when the pet is near the left edge', () => {
    // Pet near left edge: centered X would underflow → clamped to work area.
    // Pet y is low enough that panel opens above.
    const pos = computePanelPosition({ x: 0, y: 600 }, workArea);
    expect(pos.x).toBe(workArea.x);
    expect(pos.y).toBe(600 - PET_PANEL_GAP - PET_PANEL_HEIGHT);
  });

  it('centers the panel on the pet X, clamped when the pet is near the right edge', () => {
    // Pet near right edge: centered X would overflow → clamped to work area.
    const petX = workArea.width - PET_WINDOW_SIZE;
    const pos = computePanelPosition({ x: petX, y: 600 }, workArea);
    expect(pos.x).toBe(workArea.x + workArea.width - PET_PANEL_WIDTH);
  });

  it('clamps the panel fully on-screen at the bottom-right corner', () => {
    // Pet at the very bottom-right corner: panel opens above (room exists)
    // and is clamped horizontally to the work area.
    const petX = workArea.x + workArea.width - PET_WINDOW_SIZE;
    const petY = workArea.y + workArea.height - PET_WINDOW_SIZE;
    const pos = computePanelPosition({ x: petX, y: petY }, workArea);
    expect(pos.x + PET_PANEL_WIDTH).toBeLessThanOrEqual(workArea.x + workArea.width);
    expect(pos.y + PET_PANEL_HEIGHT).toBeLessThanOrEqual(workArea.y + workArea.height);
    expect(pos.x).toBeGreaterThanOrEqual(workArea.x);
    expect(pos.y).toBeGreaterThanOrEqual(workArea.y);
  });

  it('NEVER overlaps the pet, even when the work area is too short to fit the panel', () => {
    // Degenerate tiny work area: height < PET_PANEL_HEIGHT. Neither above nor
    // below has enough room for the full panel. The function must still keep
    // the panel off the pet — it picks the side with more room and places the
    // panel at the non-overlapping position for that side (aboveTop or
    // belowTop), accepting overflow past the work-area edge.
    const tiny: PetWorkArea = { x: 0, y: 0, width: 800, height: 400 };
    const petPos = { x: 340, y: 200 };
    const pos = computePanelPosition(petPos, tiny);
    // The panel must NOT overlap the pet vertically: either panel bottom <=
    // petTop - gap (panel is above), or panel top >= petBottom + gap (panel
    // is below).
    const petTop = petPos.y;
    const petBottom = petPos.y + PET_WINDOW_SIZE;
    const panelTop = pos.y;
    const panelBottom = pos.y + PET_PANEL_HEIGHT;
    const aboveOk = panelBottom <= petTop - PET_PANEL_GAP;
    const belowOk = panelTop >= petBottom + PET_PANEL_GAP;
    expect(aboveOk || belowOk).toBe(true);
    // Sanity: panel has a non-zero height.
    expect(panelBottom).toBeGreaterThan(panelTop);
  });

  it('picks the side with more room when neither above nor below fits cleanly', () => {
    // Pet in the LOWER half of a short work area: more room above than below.
    // The panel should open ABOVE (overflow above the work-area top) so its
    // bottom = petTop - gap — no overlap with the pet body. The previous
    // implementation's clamp fallback forced BELOW here, pushing the panel
    // off the bottom edge and (in some layouts) back onto the pet.
    const tiny: PetWorkArea = { x: 0, y: 0, width: 800, height: 400 };
    const petPos = { x: 340, y: 300 };
    const pos = computePanelPosition(petPos, tiny);
    // Panel is above the pet: panel bottom <= petTop - gap.
    expect(pos.y + PET_PANEL_HEIGHT).toBeLessThanOrEqual(petPos.y - PET_PANEL_GAP);
  });

  it('never overlaps the pet when opening above on a normal work area', () => {
    // Regression: when opening above, the panel bottom + gap must be ≤ pet top.
    const pos = computePanelPosition({ x: 600, y: 600 }, workArea);
    expect(pos.y + PET_PANEL_HEIGHT).toBeLessThanOrEqual(600 - PET_PANEL_GAP);
  });
});

describe('clampPanelPosition', () => {
  const workArea: PetWorkArea = { x: 0, y: 25, width: 1440, height: 875 };

  it('returns the saved position unchanged when already on-screen', () => {
    const pos = clampPanelPosition({ x: 100, y: 100 }, workArea);
    expect(pos).toEqual({ x: 100, y: 100 });
  });

  it('clamps a position off the right edge', () => {
    const pos = clampPanelPosition({ x: 99999, y: 100 }, workArea);
    expect(pos.x).toBe(workArea.x + workArea.width - PET_PANEL_WIDTH);
  });

  it('clamps a position off the bottom edge', () => {
    const pos = clampPanelPosition({ x: 100, y: 99999 }, workArea);
    expect(pos.y).toBe(workArea.y + workArea.height - PET_PANEL_HEIGHT);
  });

  it('clamps a position off the top/left edges', () => {
    const pos = clampPanelPosition({ x: -50, y: -50 }, workArea);
    expect(pos.x).toBe(workArea.x);
    expect(pos.y).toBe(workArea.y);
  });

  it('handles a work area smaller than the panel (degenerate)', () => {
    const tiny: PetWorkArea = { x: 0, y: 0, width: 100, height: 100 };
    const pos = clampPanelPosition({ x: 5000, y: 5000 }, tiny);
    expect(pos).toEqual({ x: 0, y: 0 });
  });
});

describe('clampPanelSize', () => {
  const workArea: PetWorkArea = { x: 0, y: 25, width: 1440, height: 875 };

  it('returns the saved size unchanged when it fits the work area', () => {
    const size = clampPanelSize({ width: 380, height: 520 }, workArea);
    expect(size).toEqual({ width: 380, height: 520 });
  });

  it('enforces the minimum width', () => {
    const size = clampPanelSize({ width: 100, height: 400 }, workArea);
    expect(size.width).toBe(PET_PANEL_MIN_WIDTH);
    expect(size.height).toBe(400);
  });

  it('enforces the minimum height', () => {
    const size = clampPanelSize({ width: 300, height: 50 }, workArea);
    expect(size.width).toBe(300);
    expect(size.height).toBe(PET_PANEL_MIN_HEIGHT);
  });

  it('shrinks a saved size that exceeds the work area width', () => {
    const size = clampPanelSize({ width: 99999, height: 500 }, workArea);
    expect(size.width).toBe(workArea.width);
    expect(size.height).toBe(500);
  });

  it('shrinks a saved size that exceeds the work area height', () => {
    const size = clampPanelSize({ width: 380, height: 99999 }, workArea);
    expect(size.width).toBe(380);
    expect(size.height).toBe(workArea.height);
  });

  it('falls back to minimums for a degenerate (zero) work area', () => {
    const tiny: PetWorkArea = { x: 0, y: 0, width: 0, height: 0 };
    const size = clampPanelSize({ width: 99999, height: 99999 }, tiny);
    expect(size).toEqual({ width: PET_PANEL_MIN_WIDTH, height: PET_PANEL_MIN_HEIGHT });
  });
});
