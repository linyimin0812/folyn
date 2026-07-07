/**
 * Convert a `ShortcutItem.keys` display array (e.g. `["⌘", "Shift", "Q"]`,
 * as stored by `settingsStore.ts` and rendered by `ShortcutEditor`) into the
 * Tauri accelerator grammar string (e.g. `"Cmd+Shift+Q"`) accepted by
 * `tauri-plugin-global-shortcut`'s `register` (via the
 * `pet_panel_set_shortcut` custom command).
 *
 * Mapping (display symbol → Tauri token):
 *   ⌘     → Cmd      (macOS Super)
 *   Ctrl  → Control
 *   ⌥     → Alt
 *   Shift → Shift
 *
 * Single-letter keys are uppercased (Tauri expects `"Q"`, not `"q"`, for
 * letter keys). Multi-character tokens (e.g. `"F5"`, `"Space"`, `"Enter"`)
 * are passed through unchanged. Tokens not in the map and not single-char
 * are passed through unchanged so the user can rebind to functional keys
 * without us having to whitelist them.
 *
 * Returns the empty string if `keys` is empty (the caller treats an empty
 * accelerator as "unregister only" — see `pet_panel_set_shortcut`).
 *
 * Order is preserved as-stored (modifier-first ordering is enforced by
 * `ShortcutEditor`'s recording handler: meta/ctrl/alt/shift, then the
 * non-modifier key). Tauri's accelerator parser is order-insensitive for
 * modifiers but expects the non-modifier key last; preserving stored order
 * satisfies both.
 */
export function keysToAccelerator(keys: string[]): string {
  if (keys.length === 0) return '';
  const mapped = keys.map((k) => {
    switch (k) {
      case '⌘':
        return 'Cmd';
      case 'Ctrl':
        return 'Control';
      case '⌥':
        return 'Alt';
      case 'Shift':
        return 'Shift';
      default:
        if (k.length === 1) return k.toUpperCase();
        return k;
    }
  });
  return mapped.join('+');
}
