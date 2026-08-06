/**
 * Keybinding contribution adapter (trusted-tier).
 *
 * For each `contributes.keybindings[]` entry: register a window-level
 * `keydown` listener that, when the typed event matches the contribution's
 * accelerator (`key`, or `mac` on darwin), looks up the bound command by id
 * in {@link commandRegistry} and runs it.
 *
 * ponytail: `@tauri-apps/plugin-global-shortcut` is NOT a project dependency,
 * so OS-global shortcuts (fired even when the app is unfocused) would need a
 * new Rust command. The fallback here is app-scope `keydown`: works only
 * while the app window has focus. Ceiling: a plugin-bound key won't fire when
 * the app is backgrounded. Upgrade path: add `@tauri-apps/plugin-global-shortcut`,
 * call `register(accelerator, () => runCommand(command))` in `run`, and
 * `unregister(accelerator)` in dispose; swap the `registerKeybinding` impl.
 *
 * Accelerator grammar (Tauri): modifiers joined by `+`, last token is the key,
 * e.g. `Cmd+Shift+K`, `Control+Alt+T`. Matching here is case-insensitive on
 * the key token; modifiers are compared as sets so order in the manifest
 * doesn't matter.
 */

import type { Disposable, PluginManifest } from '@quill/plugin-host';
import type { KeybindingContribution } from '@quill/plugin-host';
import { runCommand } from '@/services/commandRegistry';

interface ParsedAccelerator {
  /** Set of normalized modifier tokens (e.g. `cmd`, `shift`). */
  mods: Set<string>;
  /** Normalized key token (e.g. `k`, `f5`). */
  key: string;
}

function parseAccelerator(acc: string): ParsedAccelerator | null {
  const parts = acc.split('+').map((p) => p.trim().toLowerCase()).filter(Boolean);
  if (parts.length === 0) return null;
  const key = parts[parts.length - 1];
  const mods = new Set(parts.slice(0, -1));
  return { mods, key };
}

function normalizeEvent(e: KeyboardEvent): ParsedAccelerator {
  const mods = new Set<string>();
  if (e.metaKey) mods.add('cmd');
  if (e.ctrlKey) mods.add('control');
  if (e.altKey) mods.add('alt');
  if (e.shiftKey) mods.add('shift');
  const key = e.key.toLowerCase();
  return { mods, key };
}

// ponytail: matching on `e.key` (layout-resolved glyph) mis-matches for
// shifted-symbol accelerators — e.g. `Cmd+Shift+1` parses to key `1` but the
// event's `e.key` is `!` on a US layout. Letters (the common case, incl. the
// sample's `Cmd+Alt+Shift+T`) and function keys match fine because their
// glyph is layout-stable. Ceiling: a plugin binding a shifted-digit/symbol
// key won't fire. Upgrade path: match on `e.code` (`KeyT`, `Digit1`) instead
// of `e.key`, and parse the accelerator's last token into a `code` via a
// layout map — layout-independent but loses mac localized-key semantics.

function isDarwin(): boolean {
  return typeof navigator !== 'undefined' && /mac|iphone|ipad|ipod/i.test(navigator.platform);
}

function matchAccelerator(parsed: ParsedAccelerator, e: KeyboardEvent): boolean {
  const ev = normalizeEvent(e);
  if (ev.key !== parsed.key) return false;
  // Set equality: every declared modifier must be pressed, and no extra.
  if (ev.mods.size !== parsed.mods.size) return false;
  for (const m of parsed.mods) if (!ev.mods.has(m)) return false;
  return true;
}

function handlerFor(kb: KeybindingContribution): (e: KeyboardEvent) => void {
  const acc = parseAccelerator(isDarwin() && kb.mac ? kb.mac : kb.key);
  return (e: KeyboardEvent) => {
    if (!acc) return;
    if (matchAccelerator(acc, e)) {
      // ponytail: `when` clause is opaque in MVP — always active. Upgrade
      // path: parse `when` (e.g. `editorFocus`) and gate on host context.
      e.preventDefault();
      void runCommand(kb.command);
    }
  };
}

export function registerPluginKeybindings(manifest: PluginManifest): Disposable {
  const keybindings: KeybindingContribution[] = manifest.contributes?.keybindings ?? [];
  if (keybindings.length === 0) return { dispose: () => {} };

  const handlers: Array<(e: KeyboardEvent) => void> = [];
  for (const kb of keybindings) {
    const handler = handlerFor(kb);
    handlers.push(handler);
    document.addEventListener('keydown', handler);
  }

  return {
    dispose: () => {
      for (const h of handlers) document.removeEventListener('keydown', h);
    },
  };
}
