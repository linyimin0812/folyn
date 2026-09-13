import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { isTauri } from '@/utils/platform';
import type { PetMenuAction } from './PetContextMenu';

/**
 * PetLauncher — the quick-action grid mounted inside the pet-panel
 * window (PR2). Each button dispatches its capability via the existing
 * `pet://menu-action` Tauri event channel — the same channel the native
 * right-click menu uses (Rust emits it; here the frontend emits it). The
 * App.tsx listener in the main window handles dispatch + `focusMain()`.
 *
 * Actions that target the main editor (New Note, Daily Note, Global Search,
 * Command Palette, Show Main, Toggle Theme) hide the panel after emitting so
 * the panel doesn't linger over the newly-focused main window.
 *
 * PR3 will mount the embedded AI chat below this grid; the `PetPanelApp`
 * shell reserves a `pet-panel-chat-slot` placeholder for it.
 */

/** Emit a `pet://menu-action` event with the given action payload. The main
 *  window's App.tsx listener picks it up and dispatches the capability. */
async function emitMenuAction(action: PetMenuAction): Promise<void> {
  if (!isTauri()) return;
  try {
    const { emit } = await import('@tauri-apps/api/event');
    await emit('pet://menu-action', { action });
  } catch (err) {
    console.warn('[pet-panel] emit menu-action failed:', err);
  }
}

/** Hide the pet-panel window (custom Rust command, bypasses ACL). */
async function hidePanel(): Promise<void> {
  if (!isTauri()) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('pet_panel_hide');
  } catch (err) {
    console.warn('[pet-panel] hide failed:', err);
  }
}

interface LauncherButtonDef {
  action: PetMenuAction;
  labelKey: string;
  icon: React.ReactNode;
  /** Whether to hide the panel after emitting the action. Defaults to true. */
  closeAfter?: boolean;
}

/** The MVP launcher buttons (PRD Q4 — slimmed after the right-click menu
 *  refactor dropped `new-note` + `disable-pet`). Each dispatches via
 *  `pet://menu-action`. */
const LAUNCHER_BUTTONS: readonly LauncherButtonDef[] = [
  {
    action: 'daily-note',
    labelKey: 'pet:launcher.dailyNote',
    icon: <DailyNoteIcon />,
  },
  {
    action: 'global-search',
    labelKey: 'pet:launcher.globalSearch',
    icon: <SearchIcon />,
  },
  {
    action: 'command-palette',
    labelKey: 'pet:launcher.commandPalette',
    icon: <PaletteIcon />,
  },
  {
    action: 'show-main',
    labelKey: 'pet:launcher.showMain',
    icon: <WindowIcon />,
  },
  {
    action: 'toggle-theme',
    labelKey: 'pet:launcher.toggleTheme',
    icon: <ThemeIcon />,
  },
] as const;

export function PetLauncher() {
  const { t } = useTranslation();

  const handleButtonClick = useCallback(async (def: LauncherButtonDef) => {
    await emitMenuAction(def.action);
    if (def.closeAfter !== false) {
      await hidePanel();
    }
  }, []);

  return (
    <div className="pet-launcher">
      <div className="pet-launcher-grid" role="group" aria-label="Quick actions">
        {LAUNCHER_BUTTONS.map((def) => {
          const label = t(def.labelKey);
          return (
            <button
              key={def.action}
              type="button"
              className="pet-launcher-btn"
              onClick={() => void handleButtonClick(def)}
              aria-label={label}
            >
              <span className="pet-launcher-icon">{def.icon}</span>
              <span className="pet-launcher-label">{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Inline SVG icons ───────────────────────────────────────────────────────
// Kept inline (no icon library) per component-guidelines.md. Each is a simple
// 16×16 stroke glyph on currentColor so it inherits `--t1`/`--acc`.

function DailyNoteIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
      <path d="M5 1.5v2M11 1.5v2M5 8h6M5 10.5h4" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7" cy="7" r="4" />
      <path d="M10 10l3 3" />
    </svg>
  );
}

function PaletteIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 1.5C4.4 1.5 1.5 4.1 1.5 7.5c0 2.6 2 4.5 4.5 4.5 1 0 1.5-.6 1.5-1.3 0-.4-.2-.7-.4-1-.2-.3-.4-.6-.4-1 0-.7.6-1.3 1.3-1.3H8c2.5 0 4.5-1.9 4.5-4.2 0-1.6-1.5-3.7-4.5-3.7z" />
      <circle cx="5" cy="6" r=".6" fill="currentColor" stroke="none" />
      <circle cx="8" cy="4.5" r=".6" fill="currentColor" stroke="none" />
      <circle cx="11" cy="6" r=".6" fill="currentColor" stroke="none" />
    </svg>
  );
}

function WindowIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
      <path d="M2.5 5.5h11" />
      <circle cx="4.2" cy="4" r=".5" fill="currentColor" stroke="none" />
    </svg>
  );
}

function ThemeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 1.5A6.5 6.5 0 1 0 14.5 8c0-.4-.3-.7-.7-.7H10a1.5 1.5 0 0 1-1.5-1.5V2.2c0-.4-.3-.7-.7-.7H8z" />
      <path d="M10.5 5.5l.5.5M11.5 8l.5.5" />
    </svg>
  );
}
