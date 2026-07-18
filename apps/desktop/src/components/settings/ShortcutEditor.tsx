import { useState, useEffect, useRef, useCallback } from 'react';
import { usePrefsStore } from '@/store/prefsStore';
import { isTauri } from '@/utils/platform';

/** Map keyboard event key to display symbol */
function keyToSymbol(key: string): string {
  const map: Record<string, string> = {
    Meta: '⌘', Control: 'Ctrl', Alt: '⌥', Shift: 'Shift',
  };
  if (map[key]) return map[key];
  if (key.length === 1) return key.toUpperCase();
  return key;
}

export function ShortcutEditor({ shortcutId, currentKeys }: { shortcutId: string; currentKeys: string[] }) {
  const [recording, setRecording] = useState(false);
  // True when recording started but no keydown was captured within the
  // timeout window. App menu accelerators (e.g. Cmd+Shift+P → "Desktop Pet
  // Mode") and macOS system shortcuts (Cmd+Q, Cmd+H, Cmd+M, Cmd+W) are
  // consumed at the OS/menu layer BEFORE the webview's keydown fires — so
  // the ShortcutEditor's `handleKeyDown` listener never sees them, recording
  // stays open, and the user sees "按下快捷键…" forever with no feedback.
  // This flag flips on timeout to surface "the combo you pressed is occupied".
  const [conflictHint, setConflictHint] = useState(false);
  const updateShortcut = usePrefsStore((s) => s.updateShortcut);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    event.preventDefault();
    event.stopPropagation();

    // Ignore lone modifier keys
    if (['Meta', 'Control', 'Alt', 'Shift'].includes(event.key)) return;

    const keys: string[] = [];
    if (event.metaKey) keys.push('⌘');
    if (event.ctrlKey) keys.push('Ctrl');
    if (event.altKey) keys.push('⌥');
    if (event.shiftKey) keys.push('Shift');
    keys.push(keyToSymbol(event.key));

    updateShortcut(shortcutId, keys);
    setConflictHint(false);
    setRecording(false);

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

  useEffect(() => {
    if (!recording) return;
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [recording, handleKeyDown]);

  // Conflict-detection timeout: if no keydown is captured within 2.5s of
  // entering recording mode, flip `conflictHint` so the UI surfaces a message.
  // The keydown listener above never fires for combos consumed by the app
  // menu / macOS system (they're intercepted at the OS layer), so the only
  // signal we have is "nothing arrived". The timer is cancelled on unmount
  // or when recording exits (via capture or click-outside). 2.5s is long
  // enough that a slow user won't trip it, short enough to feel responsive.
  useEffect(() => {
    if (!recording) {
      setConflictHint(false);
      return;
    }
    setConflictHint(false);
    const id = window.setTimeout(() => setConflictHint(true), 2500);
    return () => window.clearTimeout(id);
  }, [recording]);

  // Close on click outside
  useEffect(() => {
    if (!recording) return;
    const handleClick = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setRecording(false);
      }
    };
    window.addEventListener('mousedown', handleClick);
    return () => window.removeEventListener('mousedown', handleClick);
  }, [recording]);

  return (
    <div ref={containerRef} className="sk-keys flex items-center gap-[3px] cursor-pointer" onClick={() => setRecording(true)}>
      {recording ? (
        conflictHint ? (
          <span className="key bg-amber/10 border border-amber text-amber rounded px-1.5 py-0.5 text-[10px] shadow-[0_1px_0_var(--brd2)]">未捕获到按键 — 该组合可能被 app 菜单或系统占用（⌘Q / ⌘H / ⌘M / ⌘W / ⌘⇧P）</span>
        ) : (
          <span className="key bg-accdim border border-acc text-acc rounded px-1.5 py-0.5 text-[10.5px] font-mono shadow-[0_1px_0_var(--brd2)]">按下快捷键…</span>
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
