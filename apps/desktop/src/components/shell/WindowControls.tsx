import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Minus, Square, X } from 'lucide-react';
import type { Window as TauriWindow } from '@tauri-apps/api/window';
import { isWindowsPlatform } from '@/utils/shellSidecar';

/**
 * Windows-only window controls (minimize / maximize-restore / close).
 *
 * On Windows the main window is undecorated — Rust setup calls
 * `set_decorations(false)` (see `src-tauri/src/lib.rs`) — so the native
 * titlebar and its window controls are gone; these buttons replace them at
 * the right end of the Topbar. On macOS / Linux the native titlebar stays
 * and this renders nothing.
 *
 * The Topbar header already carries `data-tauri-drag-region="deep"`, so
 * tauri-core turns the header into a drag handle (including clicks on its
 * non-interactive children) and makes double-click toggle maximize on
 * Windows — this component only supplies the three buttons.
 */
export function WindowControls() {
  const { t } = useTranslation();
  const [maximized, setMaximized] = useState(false);

  // Keep the maximize/restore icon in sync even when the user maximizes via
  // drag-to-top-edge / aero-snap instead of this button. `isMaximized` is in
  // `core:window:default`; `onResized` only needs `core:event:allow-listen`
  // (already in `core:default`), so no extra capability entry is required.
  useEffect(() => {
    if (!isWindowsPlatform()) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const win = getCurrentWindow();
      if (!cancelled) setMaximized(await win.isMaximized());
      unlisten = await win.onResized(() => {
        void win.isMaximized().then(setMaximized);
      });
    })().catch((err) => console.warn('[window-controls] setup failed:', err));
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  if (!isWindowsPlatform()) return null;

  const run = (action: (win: TauriWindow) => Promise<void>) => async () => {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await action(getCurrentWindow());
    } catch (err) {
      // ACL denials throw at runtime — log instead of swallowing so a
      // missing capability surfaces during development (window-patterns spec:
      // never an empty try/catch).
      console.warn('[window-controls] window action failed:', err);
    }
  };

  const handleMinimize = run((win) => win.minimize());
  const handleToggleMaximize = run((win) => win.toggleMaximize());
  const handleClose = run((win) => win.close());

  return (
    <div className="win-controls flex items-center shrink-0">
      <button
        className="tb-btn w-[30px] h-[30px] flex items-center justify-center rounded-[5px] text-sm text-t3 transition-all duration-150 hover:bg-hov hover:text-t1"
        onClick={handleMinimize}
        title={t('topbar:window.minimize')}
        aria-label={t('topbar:window.minimize')}
      >
        <Minus size={14} className="shrink-0" />
      </button>
      <button
        className="tb-btn w-[30px] h-[30px] flex items-center justify-center rounded-[5px] text-sm text-t3 transition-all duration-150 hover:bg-hov hover:text-t1"
        onClick={handleToggleMaximize}
        title={maximized ? t('topbar:window.restore') : t('topbar:window.maximize')}
        aria-label={maximized ? t('topbar:window.restore') : t('topbar:window.maximize')}
      >
        {maximized ? <Copy size={13} className="shrink-0" /> : <Square size={13} className="shrink-0" />}
      </button>
      <button
        className="tb-btn w-[30px] h-[30px] flex items-center justify-center rounded-[5px] text-sm text-t3 transition-all duration-150 hover:bg-red hover:text-white"
        onClick={handleClose}
        title={t('topbar:window.close')}
        aria-label={t('topbar:window.close')}
      >
        <X size={14} className="shrink-0" />
      </button>
    </div>
  );
}
