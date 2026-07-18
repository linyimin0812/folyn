import { useState, useEffect, useRef, useCallback } from 'react';
import type { RefObject } from 'react';

/**
 * Hotkey recording behavior shared by `ShortcutEditor` (prefs-store symbol
 * array, e.g. `['⌘','Shift','P']`) and `VoiceHotkeyRecorder` (voice-store
 * accelerator string, e.g. `'Cmd+Shift+V'`). The hook owns:
 *  - `recording` state + `start()` entry
 *  - a capture-phase `keydown` listener (mounted only while recording)
 *  - click-outside cancel
 *  - an optional "nothing captured within N ms → combo is occupied" hint
 *
 * It deliberately does NOT own keyshape, persistence, or OS re-registration —
 * the caller's `onCapture(event)` decides all of that, including how (or
 * whether) to handle `Escape`. Two concrete consumers justify the extraction
 * (both previously inlined the same ~30-line keydown/click-outside dance);
 * a third consumer can reuse as-is.
 *
 * Why a hook and not a shared `<HotkeyRecorder>` component: the two
 * consumers diverge in presentation (key-chip array + conflict span vs. a
 * single accelerator string + "未设置" empty state + Esc-hint). Sharing the
 * behavior while keeping the render specialized is the smallest diff that
 * kills the duplication — a render-prop/slot component would be heavier than
 * the two thin shells.
 */
export interface HotkeyRecordingResult {
  recording: boolean;
  start: () => void;
  containerRef: RefObject<HTMLDivElement>;
  conflictHint: boolean;
}

export function useHotkeyRecording(
  onCapture: (event: KeyboardEvent) => void,
  opts?: { conflictTimeoutMs?: number },
): HotkeyRecordingResult {
  const conflictTimeoutMs = opts?.conflictTimeoutMs;
  const [recording, setRecording] = useState(false);
  const [conflictHint, setConflictHint] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Latest `onCapture` in a ref so the keydown effect does not re-bind when
  // the caller's closure identity changes — mirrors the original
  // stable-listener shape (handler was useCallback over store setters).
  const onCaptureRef = useRef(onCapture);
  useEffect(() => {
    onCaptureRef.current = onCapture;
  });

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    event.preventDefault();
    event.stopPropagation();
    // Ignore lone modifier keys — wait for the non-modifier that completes a combo.
    if (['Meta', 'Control', 'Alt', 'Shift'].includes(event.key)) return;
    onCaptureRef.current(event);
    setConflictHint(false);
    setRecording(false);
  }, []);

  useEffect(() => {
    if (!recording) return;
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [recording, handleKeyDown]);

  // Conflict-detection timeout: app menu accelerators (⌘⇧P → "Desktop Pet
  // Mode") and macOS system shortcuts (⌘Q / ⌘H / ⌘M / ⌘W) are consumed at the
  // OS/menu layer BEFORE the webview's keydown fires, so the listener above
  // never sees them — the only signal is "nothing arrived". Optional: Voice's
  // recorder doesn't surface this; ShortcutEditor passes 2500ms.
  useEffect(() => {
    if (!recording || !conflictTimeoutMs) {
      setConflictHint(false);
      return;
    }
    setConflictHint(false);
    const id = window.setTimeout(() => setConflictHint(true), conflictTimeoutMs);
    return () => window.clearTimeout(id);
  }, [recording, conflictTimeoutMs]);

  // Click-outside cancels recording without committing a change.
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

  const start = useCallback(() => setRecording(true), []);

  return { recording, start, containerRef, conflictHint };
}
