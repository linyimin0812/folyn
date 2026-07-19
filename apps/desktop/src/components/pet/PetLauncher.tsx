import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isTauri } from '@/utils/platform';
import { useClipStore } from '@/store/clipStore';
import type { PetMenuAction } from './PetContextMenu';

/**
 * PetLauncher — the 8-button quick-action grid mounted inside the pet-panel
 * window (PR2). Each button dispatches its capability via the existing
 * `pet://menu-action` Tauri event channel — the same channel the native
 * right-click menu uses (Rust emits it; here the frontend emits it). The
 * App.tsx listener in the main window handles dispatch + `focusMain()`.
 *
 * Actions that target the main editor (New Note, Daily Note, Global Search,
 * Command Palette, Show Main, Toggle Theme) hide the panel after emitting so
 * the panel doesn't linger over the newly-focused main window. Disable Pet
 * emits `disable-pet` and hides. Clip from URL is special: it does NOT emit
 * or close — it reveals an inline URL form (`PetClipForm`) that runs the clip
 * flow in-panel with success/failure feedback (PRD R5).
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

type ClipStatus =
  | { kind: 'idle' }
  | { kind: 'running'; message: string }
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string };

/** Inline Clip-from-URL form. Revealed when "Clip from URL" is clicked in the
 *  launcher grid. Validates a non-empty URL, calls `useClipStore.clipUrl`
 *  (which wraps `clipService.clipUrl` — the repo's canonical fetch+AI+save
 *  path used by AiPanel/WebViewer), and shows inline feedback. Does NOT
 *  close the panel or focus the main window — the entire flow stays in-panel
 *  per PRD R5. */
function PetClipForm({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState<ClipStatus>({ kind: 'idle' });
  const inputRef = useRef<HTMLInputElement>(null);
  const statusTimerRef = useRef<number | null>(null);

  // Focus the input on mount so the user can paste immediately.
  useEffect(() => {
    inputRef.current?.focus();
    return () => {
      if (statusTimerRef.current !== null) {
        window.clearTimeout(statusTimerRef.current);
      }
    };
  }, []);

  const clearStatusAfter = useCallback((ms: number) => {
    if (statusTimerRef.current !== null) {
      window.clearTimeout(statusTimerRef.current);
    }
    statusTimerRef.current = window.setTimeout(() => {
      setStatus({ kind: 'idle' });
      statusTimerRef.current = null;
    }, ms);
  }, []);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) {
      setStatus({ kind: 'error', message: t('pet:launcher.clip.emptyUrl') });
      clearStatusAfter(3000);
      return;
    }
    setStatus({ kind: 'running', message: t('pet:launcher.clip.running') });
    try {
      const filePath = await useClipStore.getState().clipUrl(trimmed, (msg) => {
        setStatus({ kind: 'running', message: msg || t('pet:launcher.clip.running') });
      });
      setStatus({ kind: 'success', message: t('pet:launcher.clip.saved', { name: filePath.split('/').pop() ?? filePath }) });
      clearStatusAfter(6000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus({ kind: 'error', message: msg || t('pet:launcher.clip.failed') });
      clearStatusAfter(6000);
    }
  }, [url, clearStatusAfter, t]);

  const isRunning = status.kind === 'running';

  return (
    <div className="pet-clip-form" role="form" aria-label="Clip from URL">
      <form className="pet-clip-form-row" onSubmit={handleSubmit}>
        <input
          ref={inputRef}
          type="url"
          className="pet-clip-input"
          placeholder="https://..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={isRunning}
          aria-label="URL to clip"
        />
        <button
          type="submit"
          className="pet-clip-submit"
          disabled={isRunning}
        >
          {isRunning ? '…' : t('pet:launcher.clip.submit')}
        </button>
      </form>
      {status.kind !== 'idle' && (
        <div
          className={`pet-clip-status pet-clip-status-${status.kind}`}
          role="status"
        >
          {status.message}
        </div>
      )}
      <div className="pet-clip-form-footer">
        <button
          type="button"
          className="pet-clip-cancel"
          onClick={onClose}
          disabled={isRunning}
        >
          {t('pet:launcher.clip.collapse')}
        </button>
      </div>
    </div>
  );
}

interface LauncherButtonDef {
  action: PetMenuAction;
  labelKey: string;
  icon: React.ReactNode;
  /** Whether to hide the panel after emitting the action. Defaults to true. */
  closeAfter?: boolean;
}

/** The 8 MVP launcher buttons (PRD Q4). Each dispatches via `pet://menu-action`
 *  unless it's the special Clip-from-URL toggle. Disable Pet also emits
 *  `disable-pet` and hides. */
const LAUNCHER_BUTTONS: readonly LauncherButtonDef[] = [
  {
    action: 'new-note',
    labelKey: 'pet:launcher.newNote',
    icon: <NewNoteIcon />,
  },
  {
    action: 'daily-note',
    labelKey: 'pet:launcher.dailyNote',
    icon: <DailyNoteIcon />,
  },
  {
    action: 'clip-from-url',
    labelKey: 'pet:launcher.clipFromUrl',
    icon: <ClipIcon />,
    closeAfter: false,
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
  {
    action: 'disable-pet',
    labelKey: 'pet:launcher.disablePet',
    icon: <DisableIcon />,
  },
] as const;

export function PetLauncher() {
  const { t } = useTranslation();
  const [clipFormOpen, setClipFormOpen] = useState(false);

  const handleButtonClick = useCallback(async (def: LauncherButtonDef) => {
    // Clip from URL is the special in-panel flow — toggle the form, no emit.
    if (def.action === 'clip-from-url') {
      setClipFormOpen((open) => !open);
      return;
    }
    await emitMenuAction(def.action);
    if (def.closeAfter !== false) {
      await hidePanel();
    }
  }, []);

  return (
    <div className="pet-launcher">
      <div className="pet-launcher-grid" role="group" aria-label="Quick actions">
        {LAUNCHER_BUTTONS.map((def) => {
          const isClipToggle = def.action === 'clip-from-url';
          const isActiveClip = isClipToggle && clipFormOpen;
          const label = t(def.labelKey);
          return (
            <button
              key={def.action}
              type="button"
              className={`pet-launcher-btn${isActiveClip ? ' is-active' : ''}`}
              onClick={() => void handleButtonClick(def)}
              aria-label={label}
              aria-pressed={isActiveClip}
            >
              <span className="pet-launcher-icon">{def.icon}</span>
              <span className="pet-launcher-label">{label}</span>
            </button>
          );
        })}
      </div>
      {clipFormOpen && <PetClipForm onClose={() => setClipFormOpen(false)} />}
    </div>
  );
}

// ── Inline SVG icons ───────────────────────────────────────────────────────
// Kept inline (no icon library) per component-guidelines.md. Each is a simple
// 16×16 stroke glyph on currentColor so it inherits `--t1`/`--acc`.

function NewNoteIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11.5 2.5h-7a1.5 1.5 0 0 0-1.5 1.5v8a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5V4a1.5 1.5 0 0 0-1.5-1.5z" />
      <path d="M8 7v4M6 9h4" />
    </svg>
  );
}

function DailyNoteIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
      <path d="M5 1.5v2M11 1.5v2M5 8h6M5 10.5h4" />
    </svg>
  );
}

function ClipIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 3.5h6l2.5 2.5v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z" />
      <path d="M10 3.5V6h2.5M6 9h4" />
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

function DisableIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="6" />
      <path d="M3.8 3.8l8.4 8.4" />
    </svg>
  );
}
