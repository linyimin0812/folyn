import { afterEach, describe, expect, it, vi } from 'vitest';
import { PhysicalPosition, PhysicalSize } from '@tauri-apps/api/dpi';
import type { Monitor } from '@tauri-apps/api/window';
import { getPetCursorContext } from './petCursor';

const native = vi.hoisted(() => ({
  cursorPosition: vi.fn(),
  monitorFromPoint: vi.fn(),
  primaryMonitor: vi.fn(),
}));
vi.mock('@tauri-apps/api/window', () => native);

function monitor(x: number, y: number, width: number, height: number, sf: number): Monitor {
  return {
    name: 'test monitor',
    position: new PhysicalPosition(x * sf, y * sf),
    size: new PhysicalSize(width * sf, height * sf),
    scaleFactor: sf,
    workArea: {
      position: new PhysicalPosition(x * sf, (y + 25) * sf),
      size: new PhysicalSize(width * sf, (height - 25) * sf),
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

describe('getPetCursorContext', () => {
  it.each([[100, 100], [900, 600], [1600, 1000]])(
    'resolves the whole Retina display at logical cursor (%i, %i)',
    async (x, y) => {
      vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
      const retina = monitor(0, 0, 1680, 1050, 2);
      native.primaryMonitor.mockResolvedValue(retina);
      // Tao macOS scales cursorPosition by the PRIMARY monitor's factor,
      // but monitorFromPoint compares directly with logical CGDisplayBounds.
      native.cursorPosition.mockResolvedValue(new PhysicalPosition(x * 2, y * 2));
      native.monitorFromPoint.mockImplementation(async (px: number, py: number) =>
        px >= 0 && px < 1680 && py >= 0 && py < 1050 ? retina : null,
      );

      const result = await getPetCursorContext();
      expect(result.cursor).toEqual({ x, y });
      expect(native.monitorFromPoint).toHaveBeenCalledWith(x, y);
      expect(result.workArea).toEqual({ x: 0, y: 25, width: 1680, height: 1025, scale_factor: 2 });
    },
  );

  it('uses the primary cursor scale and destination work-area scale on mixed-DPI macOS', async () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
    native.primaryMonitor.mockResolvedValue(monitor(0, 0, 1680, 1050, 2));
    const external = monitor(-281, -1080, 1920, 1080, 1);
    native.cursorPosition.mockResolvedValue(new PhysicalPosition(1000, -1000));
    native.monitorFromPoint.mockImplementation(async (x: number, y: number) =>
      x >= -281 && x < 1639 && y >= -1080 && y < 0 ? external : null,
    );
    const result = await getPetCursorContext();
    expect(result.cursor).toEqual({ x: 500, y: -500 });
    expect(result.workArea).toEqual({ x: -281, y: -1055, width: 1920, height: 1055, scale_factor: 1 });
  });

  it('keeps physical monitor queries on Windows', async () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Win32');
    native.cursorPosition.mockResolvedValue(new PhysicalPosition(2400, 1200));
    native.monitorFromPoint.mockResolvedValue(monitor(0, 0, 1920, 1080, 1.5));
    const result = await getPetCursorContext();
    expect(native.monitorFromPoint).toHaveBeenCalledWith(2400, 1200);
    expect(native.primaryMonitor).not.toHaveBeenCalled();
    expect(result.cursor).toEqual({ x: 1600, y: 800 });
  });
});
