import { useCallback, useEffect } from 'react';
import { PetLauncher } from './PetLauncher';
import { PetChat } from './PetChat';

/**
 * PetPanelApp — mounted only in the `pet-panel` Tauri window (see main.tsx
 * `#/pet-panel` route switch). PR2 mounts the launcher grid (`PetLauncher`);
 * PR3 will mount the embedded AI chat below it (see `pet-panel-chat-slot`).
 *
 * Lifecycle (PR1):
 *  - Close button (×) → invoke `pet_panel_hide` to hide the window.
 *  - Esc key → same.
 *  - The pet's left-click handler (PetApp.tsx) toggles this window via
 *    `pet_panel_show` / `pet_panel_hide`; this component only owns the
 *    in-panel dismiss paths.
 *
 * The window itself is declared in `tauri.conf.json` with `visible:false`,
 * `alwaysOnTop:true`, `skipTaskbar:true`, `decorations:false`,
 * `transparent:false` (panel is opaque). Its capability file is
 * `capabilities/pet-panel.json` (grants `allow-hide` etc.). The body
 * background override lives in `pet.css` (scoped via `is-pet-panel-window`
 * on `<html>`) — the panel reuses `index.css` with the editor theme, but we
 * must NOT let it inherit the transparent body override meant for the pet
 * mascot window.
 */
export function PetPanelApp() {
  const hidePanel = useCallback(async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('pet_panel_hide');
    } catch (err) {
      console.warn('[pet-panel] hide failed:', err);
    }
  }, []);

  // Esc key dismisses the panel.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        void hidePanel();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [hidePanel]);

  return (
    <div className="pet-panel-root">
      <header className="pet-panel-header">
        <span className="pet-panel-title">Quick Actions</span>
        <button
          type="button"
          className="pet-panel-close"
          aria-label="Close pet panel"
          onClick={() => void hidePanel()}
        >
          ×
        </button>
      </header>
      <main className="pet-panel-body">
        <PetLauncher />
        {/* PR3: embedded vault-free AI chat. Persisted in its own namespace
            (pet-chat:messages) via storageClient; self-hosted CliAdapter. */}
        <div className="pet-panel-chat-slot" aria-hidden={false}>
          <PetChat />
        </div>
      </main>
    </div>
  );
}
