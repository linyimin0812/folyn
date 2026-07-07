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
  // Work area: x=0, y=25, width=1440, height=875. Center = (720, 462.5).
  const workArea: PetWorkArea = { x: 0, y: 25, width: 1440, height: 875 };
  // Default panel size — preserves the pre-existing assertions that were
  // written against the hardcoded PET_PANEL_WIDTH/HEIGHT constants.
  const defaultSize = { width: PET_PANEL_WIDTH, height: PET_PANEL_HEIGHT };

  it('pet in bottom-right quadrant: panel bottom-right corner at pet top-left corner minus gap', () => {
    // petCenterX = 1300 + 60 = 1360 >= 720 (right half).
    // petCenterY = 700 + 60 = 760 >= 462.5 (bottom half).
    // Panel extends up-left: panel right edge = pet left - gap; panel bottom
    // edge = pet top - gap.
    const pos = computePanelPosition({ x: 1300, y: 700 }, workArea, defaultSize);
    expect(pos.x).toBe(1300 - PET_PANEL_GAP - PET_PANEL_WIDTH);
    expect(pos.y).toBe(700 - PET_PANEL_GAP - PET_PANEL_HEIGHT);
    // No overlap with pet: panel right <= pet left - gap, panel bottom <=
    // pet top - gap.
    expect(pos.x + PET_PANEL_WIDTH).toBeLessThanOrEqual(1300 - PET_PANEL_GAP);
    expect(pos.y + PET_PANEL_HEIGHT).toBeLessThanOrEqual(700 - PET_PANEL_GAP);
  });

  it('pet in bottom-left quadrant: panel bottom-left corner at pet top-right corner plus gap', () => {
    // petCenterX = 20 + 60 = 80 < 720 (left half).
    // petCenterY = 700 + 60 = 760 >= 462.5 (bottom half).
    // Panel extends up-right: panel left edge = pet right + gap; panel bottom
    // edge = pet top - gap.
    const pos = computePanelPosition({ x: 20, y: 700 }, workArea, defaultSize);
    expect(pos.x).toBe(20 + PET_WINDOW_SIZE + PET_PANEL_GAP);
    expect(pos.y).toBe(700 - PET_PANEL_GAP - PET_PANEL_HEIGHT);
    expect(pos.x).toBeGreaterThanOrEqual(20 + PET_WINDOW_SIZE + PET_PANEL_GAP);
    expect(pos.y + PET_PANEL_HEIGHT).toBeLessThanOrEqual(700 - PET_PANEL_GAP);
  });

  it('pet in top-right quadrant: panel top-right corner at pet bottom-left corner minus gap', () => {
    // petCenterX = 1300 + 60 = 1360 >= 720 (right half).
    // petCenterY = 50 + 60 = 110 < 462.5 (top half).
    // Panel extends down-left: panel right edge = pet left - gap; panel top
    // edge = pet bottom + gap.
    const pos = computePanelPosition({ x: 1300, y: 50 }, workArea, defaultSize);
    expect(pos.x).toBe(1300 - PET_PANEL_GAP - PET_PANEL_WIDTH);
    expect(pos.y).toBe(50 + PET_WINDOW_SIZE + PET_PANEL_GAP);
    expect(pos.x + PET_PANEL_WIDTH).toBeLessThanOrEqual(1300 - PET_PANEL_GAP);
    expect(pos.y).toBeGreaterThanOrEqual(50 + PET_WINDOW_SIZE + PET_PANEL_GAP);
  });

  it('pet in top-left quadrant: panel top-left corner at pet bottom-right corner plus gap', () => {
    // petCenterX = 20 + 60 = 80 < 720 (left half).
    // petCenterY = 50 + 60 = 110 < 462.5 (top half).
    // Panel extends down-right: panel left edge = pet right + gap; panel top
    // edge = pet bottom + gap.
    const pos = computePanelPosition({ x: 20, y: 50 }, workArea, defaultSize);
    expect(pos.x).toBe(20 + PET_WINDOW_SIZE + PET_PANEL_GAP);
    expect(pos.y).toBe(50 + PET_WINDOW_SIZE + PET_PANEL_GAP);
  });

  it('tie-break: pet center exactly at work-area center falls into right/bottom half (extends up-left)', () => {
    // Place pet so its center is exactly at (720, 462.5):
    // petX = 720 - 60 = 660; petY = 462.5 - 60 = 402.5.
    // `>=` on both axes → right/bottom → panel extends up-left.
    const pos = computePanelPosition({ x: 660, y: 402.5 }, workArea, defaultSize);
    expect(pos.x).toBe(660 - PET_PANEL_GAP - PET_PANEL_WIDTH);
    expect(pos.y).toBe(402.5 - PET_PANEL_GAP - PET_PANEL_HEIGHT);
  });

  it('respects a non-zero work-area origin for quadrant split', () => {
    // shifted center = (100 + 1000/2, 100 + 700/2) = (600, 450).
    // Pet at (800, 500): petCenter = (860, 560) → right + bottom → up-left.
    const shifted: PetWorkArea = { x: 100, y: 100, width: 1000, height: 700 };
    const pos = computePanelPosition({ x: 800, y: 500 }, shifted, defaultSize);
    expect(pos.x).toBe(800 - PET_PANEL_GAP - PET_PANEL_WIDTH);
    expect(pos.y).toBe(500 - PET_PANEL_GAP - PET_PANEL_HEIGHT);
  });

  it('NEVER overlaps the pet, even in a degenerate tiny work area', () => {
    // Work area smaller than the panel. Quadrant still picks a corner; the
    // panel overflows the work-area edge on the diagonal side but its
    // pet-ward edge stays `PET_PANEL_GAP` away from the pet's opposite edge.
    const tiny: PetWorkArea = { x: 0, y: 0, width: 800, height: 400 };
    const petPos = { x: 340, y: 200 };
    const pos = computePanelPosition(petPos, tiny, defaultSize);
    // tiny center = (400, 200). petCenter = (400, 260). 400 >= 400 (right),
    // 260 >= 200 (bottom) → up-left. Panel right edge = pet left - gap; panel
    // bottom edge = pet top - gap.
    const petLeft = petPos.x;
    const petRight = petPos.x + PET_WINDOW_SIZE;
    const petTop = petPos.y;
    const petBottom = petPos.y + PET_WINDOW_SIZE;
    const panelLeft = pos.x;
    const panelRight = pos.x + PET_PANEL_WIDTH;
    const panelTop = pos.y;
    const panelBottom = pos.y + PET_PANEL_HEIGHT;
    // Either panel is entirely left of pet (panelRight <= petLeft - gap) or
    // entirely right (panelLeft >= petRight + gap); same for Y.
    const xClear = panelRight <= petLeft - PET_PANEL_GAP || panelLeft >= petRight + PET_PANEL_GAP;
    const yClear = panelBottom <= petTop - PET_PANEL_GAP || panelTop >= petBottom + PET_PANEL_GAP;
    expect(xClear).toBe(true);
    expect(yClear).toBe(true);
    // Sanity: panel has non-zero size.
    expect(panelRight).toBeGreaterThan(panelLeft);
    expect(panelBottom).toBeGreaterThan(panelTop);
  });

  it('never overlaps the pet when extending up-left on a normal work area', () => {
    // Regression: when the panel extends up-left, its right edge + gap must
    // be ≤ pet left, and its bottom edge + gap must be ≤ pet top.
    const pos = computePanelPosition({ x: 1300, y: 700 }, workArea, defaultSize);
    expect(pos.x + PET_PANEL_WIDTH).toBeLessThanOrEqual(1300 - PET_PANEL_GAP);
    expect(pos.y + PET_PANEL_HEIGHT).toBeLessThanOrEqual(700 - PET_PANEL_GAP);
  });

  it('clamps by the ACTUAL panel size when resized larger (regression)', () => {
    // Regression: user resized the panel to 600×700 (logical) and saved the
    // size. The panel's corner must still attach to the pet's opposite corner
    // minus gap, computed against 600×700 — NOT against the default 380×520
    // (which would leave the corner drifting off the pet). Pet at
    // (1300, 700) in the bottom-right quadrant → panel extends up-left:
    // panel right edge = pet left - gap; panel bottom edge = pet top - gap.
    const pos = computePanelPosition(
      { x: 1300, y: 700 },
      workArea,
      { width: 600, height: 700 },
    );
    expect(pos.x).toBe(1300 - PET_PANEL_GAP - 600);
    expect(pos.y).toBe(700 - PET_PANEL_GAP - 700);
    // No overlap with pet against the actual size.
    expect(pos.x + 600).toBeLessThanOrEqual(1300 - PET_PANEL_GAP);
    expect(pos.y + 700).toBeLessThanOrEqual(700 - PET_PANEL_GAP);
  });
});

describe('clampPanelPosition', () => {
  const workArea: PetWorkArea = { x: 0, y: 25, width: 1440, height: 875 };
  // Default panel size — preserves the pre-existing assertions that were
  // written against the hardcoded PET_PANEL_WIDTH/HEIGHT constants.
  const defaultSize = { width: PET_PANEL_WIDTH, height: PET_PANEL_HEIGHT };

  it('returns the saved position unchanged when already on-screen', () => {
    const pos = clampPanelPosition({ x: 100, y: 100 }, workArea, defaultSize);
    expect(pos).toEqual({ x: 100, y: 100 });
  });

  it('clamps a position off the right edge', () => {
    const pos = clampPanelPosition({ x: 99999, y: 100 }, workArea, defaultSize);
    expect(pos.x).toBe(workArea.x + workArea.width - PET_PANEL_WIDTH);
  });

  it('clamps a position off the bottom edge', () => {
    const pos = clampPanelPosition({ x: 100, y: 99999 }, workArea, defaultSize);
    expect(pos.y).toBe(workArea.y + workArea.height - PET_PANEL_HEIGHT);
  });

  it('clamps a position off the top/left edges', () => {
    const pos = clampPanelPosition({ x: -50, y: -50 }, workArea, defaultSize);
    expect(pos.x).toBe(workArea.x);
    expect(pos.y).toBe(workArea.y);
  });

  it('handles a work area smaller than the panel (degenerate)', () => {
    const tiny: PetWorkArea = { x: 0, y: 0, width: 100, height: 100 };
    const pos = clampPanelPosition({ x: 5000, y: 5000 }, tiny, defaultSize);
    expect(pos).toEqual({ x: 0, y: 0 });
  });

  it('clamps by the ACTUAL panel size when resized larger (regression)', () => {
    // Regression: user resized the panel to 600×700 (logical) and saved a
    // position near the bottom-right of a 1440×900 work area. The old
    // implementation hardcoded 380×520 → maxX=1060, maxY=380 → position
    // stayed at (1000, 300) and the 600×700 panel overflowed by 160px on
    // X and 100px on Y. With the actual size, maxX=840 and maxY=200 so the
    // whole panel fits.
    const retina: PetWorkArea = {
      x: 0,
      y: 0,
      width: 1440,
      height: 900,
      scale_factor: 1,
    };
    const pos = clampPanelPosition(
      { x: 1000, y: 300 },
      retina,
      { width: 600, height: 700 },
    );
    expect(pos).toEqual({ x: 840, y: 200 });
  });

  it('leaves the position unchanged when the panel is smaller than default', () => {
    // A panel shrunk to 300×400 at (100, 100) is well inside the work area —
    // clamp should be a no-op.
    const pos = clampPanelPosition(
      { x: 100, y: 100 },
      workArea,
      { width: 300, height: 400 },
    );
    expect(pos).toEqual({ x: 100, y: 100 });
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

  it('does NOT shrink a logical saved size on a 2x DPI (Retina) work area', () => {
    // Regression: on a 2x DPI display the work area is 1440×900 LOGICAL points
    // (scale_factor=2). A user who resized the panel to 450×600 logical must
    // get 450×600 back — NOT 450×450 (which happened when `saved` was
    // PHYSICAL px and the height was clamped against the LOGICAL work-area
    // height of 900). After the unit-cleanup fix, `saved` is logical and
    // compares directly to the logical work area.
    const retina: PetWorkArea = {
      x: 0,
      y: 0,
      width: 1440,
      height: 900,
      scale_factor: 2,
    };
    const size = clampPanelSize({ width: 450, height: 600 }, retina);
    expect(size).toEqual({ width: 450, height: 600 });
  });

  it('clamps a saved logical size that exceeds the work area on 2x DPI', () => {
    // User resized to 1500×1000 logical on a 1440×900 logical Retina work
    // area → clamp shrinks to fit. (Pre-fix, a physical-px saved value of
    // 1500 was min'd against logical workArea.width=1440 → 1440, then passed
    // to pet_panel_set_size as physical → 720 logical, half-size.)
    const retina: PetWorkArea = {
      x: 0,
      y: 0,
      width: 1440,
      height: 900,
      scale_factor: 2,
    };
    const size = clampPanelSize({ width: 1500, height: 1000 }, retina);
    expect(size).toEqual({ width: 1440, height: 900 });
  });
});
