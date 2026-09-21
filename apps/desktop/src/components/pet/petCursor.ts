import { cursorPosition, monitorFromPoint, primaryMonitor } from '@tauri-apps/api/window';
import { isMacPlatform } from '@/utils/shellSidecar';
import type { PetPosition, PetWorkArea } from './petPosition';

/** Cursor and its monitor's usable bounds, in logical screen coordinates. */
export async function getPetCursorContext(): Promise<{
  cursor: PetPosition;
  workArea: PetWorkArea & { scale_factor: number };
}> {
  const cursor = await cursorPosition();
  const mac = isMacPlatform();
  let cursorScale = 1;
  if (mac) {
    // Tao macOS returns cursor pixels scaled by the PRIMARY display,
    // while monitorFromPoint expects logical CGDisplayBounds coordinates.
    const primary = await primaryMonitor();
    if (!primary) throw new Error('No primary monitor for cursor coordinates');
    cursorScale = primary.scaleFactor;
  }
  const point = { x: cursor.x / cursorScale, y: cursor.y / cursorScale };
  const monitor = await monitorFromPoint(point.x, point.y);
  if (!monitor) throw new Error('No monitor at cursor position');
  const sf = monitor.scaleFactor;
  return {
    cursor: mac ? point : { x: cursor.x / sf, y: cursor.y / sf },
    workArea: {
      x: monitor.workArea.position.x / sf,
      y: monitor.workArea.position.y / sf,
      width: monitor.workArea.size.width / sf,
      height: monitor.workArea.size.height / sf,
      scale_factor: sf,
    },
  };
}
