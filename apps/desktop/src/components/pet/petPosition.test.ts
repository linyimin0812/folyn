import { describe, it, expect } from 'vitest';
import {
  computeDefaultPetPosition,
  clampPetPosition,
  computePanelPosition,
  computeCenteredPanelPosition,
  clampPanelPosition,
  clampPanelSize,
  resolvePanelSize,
  computeBubblePosition,
  PET_WINDOW_SIZE,
  PET_MASCOT_SIZE,
  PET_RIGHT_MARGIN,
  PET_BOTTOM_MARGIN,
  PET_MIN_TOP,
  PET_PANEL_WIDTH,
  PET_PANEL_HEIGHT,
  PET_PANEL_MIN_WIDTH,
  PET_PANEL_MIN_HEIGHT,
  PET_PANEL_GAP,
  PET_PANEL_SIZE_VERSION,
  PET_BUBBLE_WIDTH,
  PET_BUBBLE_HEIGHT,
  PET_BUBBLE_GAP,
  type PetWorkArea,
  type Placement,
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
  // The visible mascot icon (88×88) is centered inside the 120×120 pet
  // window — inset = 16px on each side. The panel corner attaches to the
  // ICON's corner, not the window's corner, so the panel visually touches
  // the mascot instead of leaving a 16px+gap gap.
  const inset = (PET_WINDOW_SIZE - PET_MASCOT_SIZE) / 2;
  // Helper: icon bounding box for a pet at petPos.
  const iconBox = (petPos: { x: number; y: number }) => ({
    left: petPos.x + inset,
    right: petPos.x + PET_WINDOW_SIZE - inset,
    top: petPos.y + inset,
    bottom: petPos.y + PET_WINDOW_SIZE - inset,
  });

  it('pet in bottom-right quadrant: panel bottom-right corner at icon top-left corner minus gap', () => {
    // petCenterX = 1300 + 60 = 1360 >= 720 (right half).
    // petCenterY = 700 + 60 = 760 >= 462.5 (bottom half).
    // Panel extends up-left: panel right edge = icon left - gap; panel bottom
    // edge = icon top - gap.
    const petPos = { x: 1300, y: 700 };
    const icon = iconBox(petPos);
    const pos = computePanelPosition(petPos, workArea, defaultSize);
    expect(pos.x).toBe(icon.left - PET_PANEL_GAP - PET_PANEL_WIDTH);
    expect(pos.y).toBe(icon.top - PET_PANEL_GAP - PET_PANEL_HEIGHT);
    // No overlap with icon: panel right <= icon left - gap, panel bottom <=
    // icon top - gap.
    expect(pos.x + PET_PANEL_WIDTH).toBeLessThanOrEqual(icon.left - PET_PANEL_GAP);
    expect(pos.y + PET_PANEL_HEIGHT).toBeLessThanOrEqual(icon.top - PET_PANEL_GAP);
  });

  it('pet in bottom-left quadrant: panel bottom-left corner at icon top-right corner plus gap', () => {
    // petCenterX = 20 + 60 = 80 < 720 (left half).
    // petCenterY = 700 + 60 = 760 >= 462.5 (bottom half).
    // Panel extends up-right: panel left edge = icon right + gap; panel bottom
    // edge = icon top - gap.
    const petPos = { x: 20, y: 700 };
    const icon = iconBox(petPos);
    const pos = computePanelPosition(petPos, workArea, defaultSize);
    expect(pos.x).toBe(icon.right + PET_PANEL_GAP);
    expect(pos.y).toBe(icon.top - PET_PANEL_GAP - PET_PANEL_HEIGHT);
    expect(pos.x).toBeGreaterThanOrEqual(icon.right + PET_PANEL_GAP);
    expect(pos.y + PET_PANEL_HEIGHT).toBeLessThanOrEqual(icon.top - PET_PANEL_GAP);
  });

  it('pet in top-right quadrant: panel top-right corner at icon bottom-left corner minus gap', () => {
    // petCenterX = 1300 + 60 = 1360 >= 720 (right half).
    // petCenterY = 50 + 60 = 110 < 462.5 (top half).
    // Panel extends down-left: panel right edge = icon left - gap; panel top
    // edge = icon bottom + gap.
    const petPos = { x: 1300, y: 50 };
    const icon = iconBox(petPos);
    const pos = computePanelPosition(petPos, workArea, defaultSize);
    expect(pos.x).toBe(icon.left - PET_PANEL_GAP - PET_PANEL_WIDTH);
    expect(pos.y).toBe(icon.bottom + PET_PANEL_GAP);
    expect(pos.x + PET_PANEL_WIDTH).toBeLessThanOrEqual(icon.left - PET_PANEL_GAP);
    expect(pos.y).toBeGreaterThanOrEqual(icon.bottom + PET_PANEL_GAP);
  });

  it('pet in top-left quadrant: panel top-left corner at icon bottom-right corner plus gap', () => {
    // petCenterX = 20 + 60 = 80 < 720 (left half).
    // petCenterY = 50 + 60 = 110 < 462.5 (top half).
    // Panel extends down-right: panel left edge = icon right + gap; panel top
    // edge = icon bottom + gap.
    const petPos = { x: 20, y: 50 };
    const icon = iconBox(petPos);
    const pos = computePanelPosition(petPos, workArea, defaultSize);
    expect(pos.x).toBe(icon.right + PET_PANEL_GAP);
    expect(pos.y).toBe(icon.bottom + PET_PANEL_GAP);
  });

  it('tie-break: pet center exactly at work-area center falls into right/bottom half (extends up-left)', () => {
    // Place pet so its center is exactly at (720, 462.5):
    // petX = 720 - PET_WINDOW_SIZE/2; petY = 462.5 - PET_WINDOW_SIZE/2.
    // `>=` on both axes → right/bottom → panel extends up-left.
    const petPos = { x: 720 - PET_WINDOW_SIZE / 2, y: 462.5 - PET_WINDOW_SIZE / 2 };
    const icon = iconBox(petPos);
    const pos = computePanelPosition(petPos, workArea, defaultSize);
    expect(pos.x).toBe(icon.left - PET_PANEL_GAP - PET_PANEL_WIDTH);
    expect(pos.y).toBe(icon.top - PET_PANEL_GAP - PET_PANEL_HEIGHT);
  });

  it('respects a non-zero work-area origin for quadrant split', () => {
    // shifted center = (100 + 1000/2, 100 + 700/2) = (600, 450).
    // Pet at (800, 500): petCenter = (860, 560) → right + bottom → up-left.
    const shifted: PetWorkArea = { x: 100, y: 100, width: 1000, height: 700 };
    const petPos = { x: 800, y: 500 };
    const icon = iconBox(petPos);
    const pos = computePanelPosition(petPos, shifted, defaultSize);
    expect(pos.x).toBe(icon.left - PET_PANEL_GAP - PET_PANEL_WIDTH);
    expect(pos.y).toBe(icon.top - PET_PANEL_GAP - PET_PANEL_HEIGHT);
  });

  it('NEVER overlaps the icon, even in a degenerate tiny work area', () => {
    // Work area smaller than the panel. Quadrant still picks a corner; the
    // panel overflows the work-area edge on the diagonal side but its
    // pet-ward edge stays `PET_PANEL_GAP` away from the icon's opposite edge.
    // The panel CAN overlap the window's transparent 16px margin around the
    // icon — that margin is transparent and click-through, so the visual
    // overlap is harmless. The invariant is against the ICON bounds.
    const tiny: PetWorkArea = { x: 0, y: 0, width: 800, height: 400 };
    const petPos = { x: 340, y: 200 };
    const icon = iconBox(petPos);
    const pos = computePanelPosition(petPos, tiny, defaultSize);
    // tiny center = (400, 200). petCenter = (400, 260). 400 >= 400 (right),
    // 260 >= 200 (bottom) → up-left. Panel right edge = icon left - gap; panel
    // bottom edge = icon top - gap.
    const panelLeft = pos.x;
    const panelRight = pos.x + PET_PANEL_WIDTH;
    const panelTop = pos.y;
    const panelBottom = pos.y + PET_PANEL_HEIGHT;
    // Either panel is entirely left of icon (panelRight <= icon left - gap) or
    // entirely right (panelLeft >= icon right + gap); same for Y.
    const xClear = panelRight <= icon.left - PET_PANEL_GAP || panelLeft >= icon.right + PET_PANEL_GAP;
    const yClear = panelBottom <= icon.top - PET_PANEL_GAP || panelTop >= icon.bottom + PET_PANEL_GAP;
    expect(xClear).toBe(true);
    expect(yClear).toBe(true);
    // Sanity: panel has non-zero size.
    expect(panelRight).toBeGreaterThan(panelLeft);
    expect(panelBottom).toBeGreaterThan(panelTop);
  });

  it('never overlaps the icon when extending up-left on a normal work area', () => {
    // Regression: when the panel extends up-left, its right edge + gap must
    // be ≤ icon left, and its bottom edge + gap must be ≤ icon top.
    const petPos = { x: 1300, y: 700 };
    const icon = iconBox(petPos);
    const pos = computePanelPosition(petPos, workArea, defaultSize);
    expect(pos.x + PET_PANEL_WIDTH).toBeLessThanOrEqual(icon.left - PET_PANEL_GAP);
    expect(pos.y + PET_PANEL_HEIGHT).toBeLessThanOrEqual(icon.top - PET_PANEL_GAP);
  });

  it('clamps by the ACTUAL panel size when resized larger (regression)', () => {
    // Regression: user resized the panel to 600×700 (logical) and saved the
    // size. The panel's corner must still attach to the icon's opposite corner
    // minus gap, computed against 600×700 — NOT against the default 600×840
    // (which would leave the corner drifting off the icon). Pet at
    // (1300, 700) in the bottom-right quadrant → panel extends up-left:
    // panel right edge = icon left - gap; panel bottom edge = icon top - gap.
    const petPos = { x: 1300, y: 700 };
    const icon = iconBox(petPos);
    const pos = computePanelPosition(
      petPos,
      workArea,
      { width: 600, height: 700 },
    );
    expect(pos.x).toBe(icon.left - PET_PANEL_GAP - 600);
    expect(pos.y).toBe(icon.top - PET_PANEL_GAP - 700);
    // No overlap with icon against the actual size.
    expect(pos.x + 600).toBeLessThanOrEqual(icon.left - PET_PANEL_GAP);
    expect(pos.y + 700).toBeLessThanOrEqual(icon.top - PET_PANEL_GAP);
  });
});

describe('clampPanelPosition', () => {
  const workArea: PetWorkArea = { x: 0, y: 25, width: 1440, height: 875 };
  // Default panel size — preserves the pre-existing assertions that were
  // written against the hardcoded PET_PANEL_WIDTH/HEIGHT constants.
  const defaultSize = { width: PET_PANEL_WIDTH, height: PET_PANEL_HEIGHT };

  it('returns the saved position unchanged when already on-screen', () => {
    const pos = clampPanelPosition({ x: 100, y: 30 }, workArea, defaultSize);
    expect(pos).toEqual({ x: 100, y: 30 });
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

describe('resolvePanelSize', () => {
  const workArea: PetWorkArea = { x: 0, y: 25, width: 1440, height: 875 };

  it('returns the clamped saved size when the version matches', () => {
    // Saved 380×520 with the current version → clamped to fit the work area
    // (no shrinkage needed since 380×520 fits inside 1440×875) and returned.
    const size = resolvePanelSize(
      { width: 380, height: 520 },
      PET_PANEL_SIZE_VERSION,
      workArea,
    );
    expect(size).toEqual({ width: 380, height: 520 });
  });

  it('returns the default when the saved version mismatches (e.g. default-size bump)', () => {
    // Simulates an existing user whose persisted size is the OLD default
    // (380×520) saved with version 0 — the default has since bumped to
    // 440×620 (version 1). The saved size must be IGNORED so the new
    // default applies on next open instead of being shadowed.
    const size = resolvePanelSize(
      { width: 380, height: 520 },
      0, // pre-versioning / mismatched
      workArea,
    );
    expect(size).toEqual({ width: PET_PANEL_WIDTH, height: PET_PANEL_HEIGHT });
  });

  it('returns the default on first-ever open (saved.width <= 0)', () => {
    // `petPanelWidth/Height` default to -1 (unset). Even with a matching
    // version (an impossible state in practice — version is 0 on first
    // open — but the helper guards defensively), a non-positive saved
    // dimension falls through to the default branch.
    const size = resolvePanelSize(
      { width: -1, height: -1 },
      PET_PANEL_SIZE_VERSION,
      workArea,
    );
    expect(size).toEqual({ width: PET_PANEL_WIDTH, height: PET_PANEL_HEIGHT });
  });

  it('clamps (shrinks) the saved size when version matches but size exceeds the work area', () => {
    // User resized the panel to 2000×1500 logical on a 1440×875 work area
    // and saved it with the current version. The clamped size shrinks to
    // fit the work area — the saved size is respected but bounded.
    const size = resolvePanelSize(
      { width: 2000, height: 1500 },
      PET_PANEL_SIZE_VERSION,
      workArea,
    );
    expect(size).toEqual({ width: 1440, height: 875 });
  });

  it('ignores the saved size even if it fits the work area when the version mismatches', () => {
    // Regression guard: a saved size that happens to fit the work area must
    // STILL be ignored when the version mismatches — the version-gate is
    // authoritative, not the size's validity. Otherwise a default-bump
    // would silently no-op for users whose saved size happened to fit.
    const size = resolvePanelSize(
      { width: 500, height: 700 }, // fits 1440×875
      0, // mismatched version
      workArea,
    );
    expect(size).toEqual({ width: PET_PANEL_WIDTH, height: PET_PANEL_HEIGHT });
  });

  it('enforces minimums on a saved size that drops below PET_PANEL_MIN_*', () => {
    // Saved 100×100 with matching version → clampPanelSize enforces the
    // minimum width/height. Mirrors the clampPanelSize contract.
    const size = resolvePanelSize(
      { width: 100, height: 100 },
      PET_PANEL_SIZE_VERSION,
      workArea,
    );
    expect(size.width).toBe(PET_PANEL_MIN_WIDTH);
    expect(size.height).toBe(PET_PANEL_MIN_HEIGHT);
  });
});

describe('computeCenteredPanelPosition', () => {
  const workArea: PetWorkArea = { x: 0, y: 25, width: 1440, height: 875, scale_factor: 2 };

  it('centers the panel in the work area (logical points)', () => {
    const pos = computeCenteredPanelPosition(workArea, { width: PET_PANEL_WIDTH, height: PET_PANEL_HEIGHT });
    expect(pos.x).toBe(Math.round((1440 - PET_PANEL_WIDTH) / 2));
    expect(pos.y).toBe(Math.round(25 + (875 - PET_PANEL_HEIGHT) / 2));
  });

  it('offsets by a nonzero work-area origin', () => {
    const wa: PetWorkArea = { x: 100, y: 50, width: 1000, height: 600, scale_factor: 2 };
    const pos = computeCenteredPanelPosition(wa, { width: 200, height: 400 });
    expect(pos.x).toBe(Math.round(100 + (1000 - 200) / 2));
    expect(pos.y).toBe(Math.round(50 + (600 - 400) / 2));
  });

  it('pins to work-area top-left when panel is larger than the work area', () => {
    const wa: PetWorkArea = { x: 0, y: 0, width: 100, height: 100, scale_factor: 2 };
    const pos = computeCenteredPanelPosition(wa, { width: 500, height: 700 });
    expect(pos.x).toBe(0);
    expect(pos.y).toBe(0);
  });
});

describe('computeBubblePosition', () => {
  // Medium pet (96×96). Work area mirrors a 1440×875 desktop minus menu bar.
  const workArea: PetWorkArea = { x: 0, y: 25, width: 1440, height: 875, scale_factor: 2 };

  it('places the bubble above the pet, centered on the pet (bottom-right pet)', () => {
    const petPos = { x: 1344, y: 731 }; // petCenterX = 1392
    const pos = computeBubblePosition(petPos, workArea);
    // X centered on pet then clamped into work area (maxX = 1440-320 = 1120).
    expect(pos.x).toBe(1120);
    // Y = petTop - gap - bubbleHeight = 731 - 6 - 120 = 605 (>= 25, so above).
    expect(pos.y).toBe(605);
  });

  it('flips below the pet when there is no room above (menu bar)', () => {
    const petPos = { x: 600, y: 30 }; // aboveY = -96 < 25 → flip
    const pos = computeBubblePosition(petPos, workArea);
    // X centered: 648 - 160 = 488, within [0, 1120].
    expect(pos.x).toBe(488);
    // Y = petTop + petSize + gap = 30 + 96 + 6 = 132.
    expect(pos.y).toBe(132);
  });

  it('clamps X to the work-area right edge when the pet is near the right edge', () => {
    const petPos = { x: 1500, y: 731 }; // petCenterX = 1548 → raw x = 1388
    const pos = computeBubblePosition(petPos, workArea);
    expect(pos.x).toBe(1120); // clamped to maxX
    expect(pos.y).toBe(605);
  });

  it('respects a nonzero work-area origin', () => {
    const wa: PetWorkArea = { x: 100, y: 50, width: 1000, height: 600, scale_factor: 2 };
    const petPos = { x: 1056, y: 554 }; // petCenterX = 1104 → raw x = 944
    const pos = computeBubblePosition(petPos, wa);
    // maxX = 100 + 1000 - 320 = 780 → 944 clamps down to 780.
    expect(pos.x).toBe(780);
    // aboveY = 554 - 6 - 120 = 428 (>= 50, so above).
    expect(pos.y).toBe(428);
  });

  it('keeps the bubble inside the work area when the pet is small', () => {
    const petPos = { x: 20, y: 40 };
    const pos = computeBubblePosition(petPos, workArea, '50');
    // 50% pet = 48px; petCenterX = 20+24 = 44 → raw x = 44-160 = -116 → clamped to 0.
    expect(pos.x).toBe(0);
    // aboveY = 40 - 6 - 120 = -86 < 25 → below = 40 + 48 + 6 = 94.
    expect(pos.y).toBe(94);
  });

  it('honors a custom bubbleSize (e.g. 540×280 Cloudia card) for clamp + flip', () => {
    // Pet at bottom-right; the 540×280 card centers on the pet and clamps to
    // the right edge of the work area.
    const petPos = { x: 1344, y: 731 }; // petCenterX = 1392
    const pos = computeBubblePosition(petPos, workArea, '100', {
      width: 540,
      height: 280,
    });
    // maxX = 1440 - 540 = 900 → raw x = 1392 - 270 = 1122 → clamped to 900.
    expect(pos.x).toBe(900);
    // aboveY = 731 - 6 - 280 = 445 (>= 25, so above).
    expect(pos.y).toBe(445);
  });

  it('flips below for a tall custom bubble when above has no room', () => {
    // Pet near the menu bar; a 280-tall card cannot fit above.
    const petPos = { x: 600, y: 30 };
    const pos = computeBubblePosition(petPos, workArea, '100', {
      width: 540,
      height: 280,
    });
    // X centered: 648 - 270 = 378, within [0, 900].
    expect(pos.x).toBe(378);
    // aboveY = 30 - 6 - 280 = -256 < 25 → below = 30 + 96 + 6 = 132.
    expect(pos.y).toBe(132);
  });

  // ── Placement-aware behavior (PRD: pet-popover-corner) ───────────────────
  // 12 antd-style placements. Default 'top' preserves the legacy behavior
  // proven by the tests above; the cases below cover the other 11 placements
  // + flip + auto-shift rules.

  describe('placement: bottom', () => {
    it('places the bubble below the pet, centered (default pet size)', () => {
      const petPos = { x: 600, y: 400 };
      const pos = computeBubblePosition(petPos, workArea, '100', undefined, 'bottom');
      // X centered: 648 - 160 = 488.
      expect(pos.x).toBe(488);
      // Y = petTop + petSize + gap = 400 + 96 + 6 = 502.
      expect(pos.y).toBe(502);
    });

    it('flips above when there is no room below (pet at screen bottom)', () => {
      const petPos = { x: 600, y: 850 }; // belowY = 850 + 96 + 6 = 952 > 25+875 = 900
      const pos = computeBubblePosition(petPos, workArea, '100', undefined, 'bottom');
      // Y above = 850 - 6 - 120 = 724 (>= 25, fits).
      expect(pos.y).toBe(724);
    });

    it('clamps X to the work-area left edge when pet near left edge', () => {
      const petPos = { x: 0, y: 400 }; // petCenterX = 48 → raw x = -112
      const pos = computeBubblePosition(petPos, workArea, '100', undefined, 'bottom');
      expect(pos.x).toBe(0);
    });
  });

  describe('placement: topLeft / topRight / bottomLeft / bottomRight', () => {
    it('topLeft: bubble left edge aligns to pet left, bubble above pet', () => {
      const petPos = { x: 600, y: 400 };
      const pos = computeBubblePosition(petPos, workArea, '100', undefined, 'topLeft');
      // X: bubble left = pet left = 600.
      expect(pos.x).toBe(600);
      // Y = petTop - gap - bubbleH = 400 - 6 - 120 = 274.
      expect(pos.y).toBe(274);
    });

    it('topLeft flips vertically to bottomLeft when above has no room', () => {
      const petPos = { x: 600, y: 30 }; // aboveY = 30 - 6 - 120 = -96 < 25
      const pos = computeBubblePosition(petPos, workArea, '100', undefined, 'topLeft');
      // X preserved: 600.
      expect(pos.x).toBe(600);
      // Y = 30 + 96 + 6 = 132.
      expect(pos.y).toBe(132);
    });

    it('topRight: bubble right edge aligns to pet right, bubble above pet', () => {
      const petPos = { x: 600, y: 400 };
      const pos = computeBubblePosition(petPos, workArea, '100', undefined, 'topRight');
      // X: bubble right = pet right = 600 + 96 = 696 → bubble left = 696 - 320 = 376.
      expect(pos.x).toBe(376);
      // Y = 274 (same as topLeft).
      expect(pos.y).toBe(274);
    });

    it('topRight flips vertically to bottomRight when above has no room', () => {
      const petPos = { x: 600, y: 30 };
      const pos = computeBubblePosition(petPos, workArea, '100', undefined, 'topRight');
      expect(pos.x).toBe(376);
      expect(pos.y).toBe(132);
    });

    it('bottomLeft: bubble left edge aligns to pet left, bubble below pet', () => {
      const petPos = { x: 600, y: 400 };
      const pos = computeBubblePosition(petPos, workArea, '100', undefined, 'bottomLeft');
      expect(pos.x).toBe(600);
      expect(pos.y).toBe(502);
    });

    it('bottomLeft flips vertically to topLeft when below has no room', () => {
      const petPos = { x: 600, y: 850 };
      const pos = computeBubblePosition(petPos, workArea, '100', undefined, 'bottomLeft');
      expect(pos.x).toBe(600);
      expect(pos.y).toBe(724);
    });

    it('bottomRight: bubble right edge aligns to pet right, bubble below pet', () => {
      const petPos = { x: 600, y: 400 };
      const pos = computeBubblePosition(petPos, workArea, '100', undefined, 'bottomRight');
      expect(pos.x).toBe(376);
      expect(pos.y).toBe(502);
    });
  });

  describe('placement: left / right (single direction, Y auto-shift)', () => {
    it('left: bubble to the left of pet, vertically centered on pet', () => {
      const petPos = { x: 600, y: 400 };
      const pos = computeBubblePosition(petPos, workArea, '100', undefined, 'left');
      // X = petLeft - gap - bubbleW = 600 - 6 - 320 = 274.
      expect(pos.x).toBe(274);
      // Y centered: petCenterY - bubbleH/2 = 448 - 60 = 388.
      expect(pos.y).toBe(388);
    });

    it('left flips to right when there is no room on the left (pet at left edge)', () => {
      const petPos = { x: 100, y: 400 }; // leftX = 100 - 6 - 320 = -226 < 0
      const pos = computeBubblePosition(petPos, workArea, '100', undefined, 'left');
      // X = petRight + gap = 100 + 96 + 6 = 202.
      expect(pos.x).toBe(202);
      expect(pos.y).toBe(388);
    });

    it('left clamps Y to work-area top when pet near top', () => {
      const petPos = { x: 600, y: 25 }; // petCenterY = 73 → raw y = 13 < 25
      const pos = computeBubblePosition(petPos, workArea, '100', undefined, 'left');
      expect(pos.x).toBe(274);
      expect(pos.y).toBe(25); // clamped to workArea.y
    });

    it('left clamps Y to work-area bottom when pet near bottom', () => {
      const petPos = { x: 600, y: 850 }; // petCenterY = 898 → raw y = 838 → 838+120=958 > 900 → clamp
      const pos = computeBubblePosition(petPos, workArea, '100', undefined, 'left');
      expect(pos.x).toBe(274);
      // maxY = 25 + 875 - 120 = 780.
      expect(pos.y).toBe(780);
    });

    it('right: bubble to the right of pet, vertically centered on pet', () => {
      const petPos = { x: 600, y: 400 };
      const pos = computeBubblePosition(petPos, workArea, '100', undefined, 'right');
      // X = petRight + gap = 696 + 6 = 702.
      expect(pos.x).toBe(702);
      expect(pos.y).toBe(388);
    });

    it('right flips to left when there is no room on the right (pet at right edge)', () => {
      const petPos = { x: 1300, y: 400 }; // rightX = 1300 + 96 + 6 = 1402 → 1402+320=1722 > 1440
      const pos = computeBubblePosition(petPos, workArea, '100', undefined, 'right');
      // X = petLeft - gap - bubbleW = 1300 - 6 - 320 = 974.
      expect(pos.x).toBe(974);
      expect(pos.y).toBe(388);
    });
  });

  describe('placement: leftTop / leftBottom / rightTop / rightBottom', () => {
    it('leftTop: bubble top edge aligns to pet top, bubble left of pet', () => {
      const petPos = { x: 600, y: 400 };
      const pos = computeBubblePosition(petPos, workArea, '100', undefined, 'leftTop');
      // X = petLeft - gap - bubbleW = 274.
      expect(pos.x).toBe(274);
      // Y = petTop = 400.
      expect(pos.y).toBe(400);
    });

    it('leftTop flips horizontally to rightTop when left has no room', () => {
      const petPos = { x: 100, y: 400 };
      const pos = computeBubblePosition(petPos, workArea, '100', undefined, 'leftTop');
      // X = petRight + gap = 100 + 96 + 6 = 202.
      expect(pos.x).toBe(202);
      // Y preserved: 400.
      expect(pos.y).toBe(400);
    });

    it('leftBottom: bubble bottom edge aligns to pet bottom, bubble left of pet', () => {
      const petPos = { x: 600, y: 400 };
      const pos = computeBubblePosition(petPos, workArea, '100', undefined, 'leftBottom');
      expect(pos.x).toBe(274);
      // Y = petBottom - bubbleH = 400 + 96 - 120 = 376.
      expect(pos.y).toBe(376);
    });

    it('rightTop: bubble top edge aligns to pet top, bubble right of pet', () => {
      const petPos = { x: 600, y: 400 };
      const pos = computeBubblePosition(petPos, workArea, '100', undefined, 'rightTop');
      // X = petRight + gap = 702.
      expect(pos.x).toBe(702);
      expect(pos.y).toBe(400);
    });

    it('rightBottom: bubble bottom edge aligns to pet bottom, bubble right of pet', () => {
      const petPos = { x: 600, y: 400 };
      const pos = computeBubblePosition(petPos, workArea, '100', undefined, 'rightBottom');
      expect(pos.x).toBe(702);
      expect(pos.y).toBe(376);
    });
  });
});
