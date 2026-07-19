import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { usePrefsStore } from '@/store/prefsStore';
import { isTauri } from '@/utils/platform';
import { useHotkeyRecording } from '@/components/settings/useHotkeyRecording';

/** Map keyboard event key to display symbol */
function keyToSymbol(key: string): string {
  const map: Record<string, string> = {
    Meta: '⌘', Control: 'Ctrl', Alt: '⌥', Shift: 'Shift',
  };
  if (map[key]) return map[key];
  if (key.length === 1) return key.toUpperCase();
  return key;
}

/**
 * Shortcut editor for the prefs-store keybinds (symbol-array shape, e.g.
 * `['⌘','Shift','P']`). The recording mechanics live in `useHotkeyRecording`;
 * this shell owns the prefs-specific bits: the ⌘-symbol keyshape,
 * `updateShortcut` persistence, and OS re-registration of the one global
 * shortcut (`togglePetPanel` → `pet_panel_set_shortcut` Rust command).
 */
export function ShortcutEditor({ shortcutId, currentKeys }: { shortcutId: string; currentKeys: string[] }) {
  const { t } = useTranslation();
  const updateShortcut = usePrefsStore((s) => s.updateShortcut);

  const onCapture = useCallback((event: KeyboardEvent) => {
    const keys: string[] = [];
    if (event.metaKey) keys.push('⌘');
    if (event.ctrlKey) keys.push('Ctrl');
    if (event.altKey) keys.push('⌥');
    if (event.shiftKey) keys.push('Shift');
    keys.push(keyToSymbol(event.key));

    updateShortcut(shortcutId, keys);

    // Global shortcuts (currently only `togglePetPanel`) are registered with
    // the OS via the `pet_panel_set_shortcut` Rust command. Re-register on
    // every rebind so the new combo takes effect system-wide immediately —
    // the command unregisters the old accelerator before registering the new
    // one. In-editor keybindings (everything else) need no Rust-side action;
    // they're consumed by EditorView's keymap. Non-Tauri/test envs skip this.
    if (shortcutId === 'togglePetPanel' && isTauri()) {
      void (async () => {
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          const { keysToAccelerator } = await import('@/utils/shortcutAccelerator');
          const accelerator = keysToAccelerator(keys);
          await invoke('pet_panel_set_shortcut', { accelerator });
          console.info('[settings] global shortcut re-registered:', accelerator);
        } catch (err) {
          console.warn('[settings] failed to re-register global shortcut:', err);
        }
      })();
    }
  }, [shortcutId, updateShortcut]);

  const { recording, start, containerRef, conflictHint } = useHotkeyRecording(onCapture, { conflictTimeoutMs: 2500 });

  return (
    <div ref={containerRef} className="sk-keys flex items-center gap-[3px] cursor-pointer" onClick={start}>
      {recording ? (
        conflictHint ? (
          <span className="key bg-amber/10 border border-amber text-amber rounded px-1.5 py-0.5 text-[10px] shadow-[0_1px_0_var(--brd2)]">{t('settings:shortcuts.editor.conflictHint')}</span>
        ) : (
          <span className="key bg-accdim border border-acc text-acc rounded px-1.5 py-0.5 text-[10.5px] font-mono shadow-[0_1px_0_var(--brd2)]">{t('settings:shortcuts.editor.recording')}</span>
        )
      ) : (
        currentKeys.map((k, i) => (
          <span key={i}>
            {i > 0 && <span className="text-t3 text-[9px]">+</span>}
            <span className="key bg-surf2 border border-brd2 rounded px-1.5 py-0.5 text-[10.5px] font-mono text-t1 shadow-[0_1px_0_var(--brd2)]">{k}</span>
          </span>
        ))
      )}
    </div>
  );
}
