/**
 * Convert a `ShortcutItem.keys` display array (e.g. `["⌘", "Shift", "Q"]`,
 * as stored by `prefsStore.ts` and rendered by `ShortcutEditor`) into the
 * Tauri accelerator grammar string (e.g. `"Cmd+Shift+Q"`) accepted by
 * `tauri-extension-global-shortcut`'s `register` (via the
 * `pet_panel_set_shortcut` custom command).
 *
 * Mapping (display symbol → Tauri token):
 *   ⌘     → Cmd      (macOS Command)
 *   Ctrl  → Control
 *   ⌥     → Alt      (macOS Option)
 *   Win   → Super    (Windows logo key)
 *   Shift → Shift
 *
 * Single-letter keys are uppercased (Tauri expects `"Q"`, not `"q"`, for
 * letter keys). Multi-character tokens (e.g. `"F5"`, `"Space"`, `"Enter"`,
 * and `"Alt"` — Windows/Linux Alt) are passed through unchanged. Tokens not
 * in the map and not single-char are passed through unchanged so the user can
 * rebind to functional keys without us having to whitelist them.
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
      case 'Win':
        return 'Super';
      case 'Shift':
        return 'Shift';
      default:
        if (k.length === 1) return k.toUpperCase();
        return k;
    }
  });
  return mapped.join('+');
}

/**
 * Match a prefsStore ShortcutItem's display-symbol keys (e.g. ['⌘','Shift','I']
 * on mac, ['Ctrl','Shift','I'] on Windows) against a KeyboardEvent. Modifiers
 * are matched as an exact set (every declared mod pressed, no extras) so a
 * re-recorded combo is honored precisely. Single non-modifier token compared
 * case-insensitively. Mirrors keybindingAdapter's matchAccelerator approach.
 * (Moved here from App.tsx — split-oversized-p1-files.)
 */
export function eventMatchesShortcut(e: KeyboardEvent, keys: string[]): boolean {
  let mainKey = '';
  let mainCount = 0;
  const required: Array<(ev: KeyboardEvent) => boolean> = [];
  for (const k of keys) {
    switch (k) {
      case '⌘': case 'Win': required.push((ev) => ev.metaKey); break;
      case 'Ctrl': required.push((ev) => ev.ctrlKey); break;
      case '⌥': case 'Alt': required.push((ev) => ev.altKey); break;
      case 'Shift': required.push((ev) => ev.shiftKey); break;
      default: mainKey = k.toLowerCase(); mainCount++;
    }
  }
  if (mainCount !== 1) return false;
  if (mainKey !== e.key.toLowerCase()) return false;
  // Exact modifier set: every required mod pressed AND no extra mod pressed.
  for (const ok of required) if (!ok(e)) return false;
  const requiredLen = required.length;
  const pressedCount =
    (e.metaKey ? 1 : 0) + (e.ctrlKey ? 1 : 0) + (e.altKey ? 1 : 0) + (e.shiftKey ? 1 : 0);
  return pressedCount === requiredLen;
}
