// useVoiceGlobalHotkey — registers the persisted voice toggle hotkey with the
// Rust global-shortcut handler and routes `voice://hotkey-toggle` events into
// useVoiceInput. Extracted from App.tsx (split-oversized-p1-files).
//
// Spec: hook-guidelines.md (effect cleanup, teardown-races-await guard).

import { useEffect } from 'react';
import { isTauri } from '@/utils/platform';

export function useVoiceGlobalHotkey() {
  // ── Voice input: global toggle hotkey ──
  // Registers the persisted voice hotkey on mount and listens for
  // `voice://hotkey-toggle` events from the `tauri-extension-global-shortcut`
  // handler in `lib.rs`. Toggle semantics (mirrors openless `qa_hotkey.rs`):
  // each press flips the state — idle → start, recording → stop → transcribe
  // → polish → insert. Other phases are ignored by the guards already in
  // `useVoiceInput.start`/`.stop`. Reuses the SAME flow as the mic button.
  //
  // Root cause for the subscribe pattern: `loadSettings()` is fire-and-forget
  // async (`settingsPersistence.ts`), so `useVoiceStore.getState().globalHotkey`
  // at mount time reads the default `''` before hydration lands — the mount-time
  // register silently no-ops. Subscribing to globalHotkey changes lets the
  // hydration `''` → 'Cmd+Shift+V' transition re-register without re-running
  // the whole effect (no listener churn). Non-Tauri/test envs skip.
  useEffect(() => {
    if (!isTauri()) return;
    let unlistenToggle: (() => void) | undefined;
    let unsubHotkey: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const { listen } = await import('@tauri-apps/api/event');
        const { useVoiceStore } = await import('@/store/voiceStore');
        const { useVoiceInput } = await import('@/hooks/useVoiceInput');

        const register = async (accel: string) => {
          if (!accel || cancelled) return;
          try {
            await invoke('voice_set_global_hotkey', { accelerator: accel });
          } catch (err) {
            console.warn('[voice] hotkey register failed:', err);
          }
        };

        // Initial register (covers the cache-hit case where hydration finished
        // before this effect ran). StrictMode teardown-races-await: the first
        // mount's cleanup may run while this `await` is in flight; `cancelled`
        // gates the stale register so only the remount's register lands.
        await register(useVoiceStore.getState().globalHotkey);

        // Re-register whenever the persisted hotkey hydrates/changes. Without
        // this, first launch picks up an empty hotkey and never re-registers
        // once hydration lands the real value → user must open VoiceSettings
        // and re-set the hotkey to trigger the invoke.
        unsubHotkey = useVoiceStore.subscribe((state, prev) => {
          if (state.globalHotkey !== prev.globalHotkey) {
            void register(state.globalHotkey);
          }
        });

        // One event = one toggle. Read phase and flip; the hook's own guards
        // make a stray toggle during transcribe/polish/insert a no-op.
        // 'inserting' is also allowed through to start() so the user can
        // break out of the post-no-API-key linger (idleNoticeTimer running)
        // — start() itself rejects the call if no linger is active.
        unlistenToggle = await listen('voice://hotkey-toggle', () => {
          const { phase, start, stop } = useVoiceInput.getState();
          if (phase === 'idle' || phase === 'inserting') void start('hotkey');
          else if (phase === 'recording') void stop();
        });
      } catch (err) {
        console.warn('[voice] hotkey listener setup failed:', err);
      }
      // ponytail: StrictMode teardown-races-await canonical guard (mirrors
      // VoiceOrbOverlay.tsx:76-98): if cleanup already ran while we were
      // awaiting `listen` / `subscribe`, drop the listeners right now so they
      // don't leak.
      if (cancelled) {
        unlistenToggle?.();
        unsubHotkey?.();
      }
    })();
    return () => {
      cancelled = true;
      unlistenToggle?.();
      unsubHotkey?.();
    };
  }, []);
}
