// VoiceOrbApp — the SiriGL waveform host mounted in the `voice-orb` Tauri
// window (transparent, always-on-top, nonactivating NSPanel — declared in
// tauri.conf.json `voice-orb` and converted in `pet_panel_macos::convert_windows`).
//
// This is the cross-app recording indicator: when the user presses the global
// voice hotkey while another app (VS Code, browser) has focus, this window
// appears at the bottom-center of the primary screen with the openless SiriGL
// animation. The Rust `voice_start` command shows the window (see
// `voice::show_voice_orb`); this frontend owns the HIDE (via
// `invoke('voice_orb_hide')`) because the transcribing/polishing/inserting
// phases are frontend-only state — Rust has no visibility into them.
//
// Cross-window state: Tauri windows are separate JS realms, so the main
// window's `useVoiceInput` store does NOT sync here. The main window emits
// `voice://orb-phase` on every phase change (see `useVoiceInput.ts`); this
// component listens for those events as its source of truth. The mic level
// arrives via `voice://mic-level` (broadcast by the Rust recorder).
//
// Phase → visual mapping mirrors VoiceOrbOverlay (kept in sync for parity):
//   recording           → wave mode, resolved=true, level=live mic RMS
//   transcribing/       → orb mode (speed 1.5, thinking dots spin up)
//   polishing
//   inserting           → orb mode, merging=true (six points collapse to center)
//   idle/error          → hide the window (canvas unmounts → GL released)

import { useEffect, useRef, useState } from 'react';
import { isTauri } from '@/utils/platform';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { VoicePhase, VoiceTrigger } from '@/hooks/useVoiceInput';
import { SiriGL, isWebGLAvailable, warmUpSiriShaders } from './SiriGL';

interface OrbPhasePayload {
  phase: VoicePhase;
  trigger: VoiceTrigger;
}

/** Openless pill metrics — 460×180 (capsuleLayout.ts). Mirrors
 *  `VoiceOrbOverlay`'s STAGE_WIDTH/HEIGHT so the shader's internal coordinate
 *  system is identical to the in-AI-panel variant. The Tauri window is sized
 *  to the same logical points (tauri.conf.json `voice-orb`); the canvas fills
 *  the window so the waveform occupies the full transparent surface. */
const STAGE_WIDTH = 460;
const STAGE_HEIGHT = 180;

function phaseToVisible(phase: VoicePhase): boolean {
  return (
    phase === 'recording' ||
    phase === 'transcribing' ||
    phase === 'polishing' ||
    phase === 'inserting'
  );
}

export function VoiceOrbApp(): JSX.Element {
  const [phase, setPhase] = useState<VoicePhase>('idle');
  const [trigger, setTrigger] = useState<VoiceTrigger>(null);
  const [level, setLevel] = useState(0);
  const orbPhaseHeardRef = useRef(false);

  // Lazy-warm the shaders on first mount so the first recording doesn't pay
  // the 30-50 ms GL compile latency. Matches openless Capsule.tsx's
  // `warmUpSiriShaders()` idle call.
  const warmedRef = useRef(false);
  if (!warmedRef.current) {
    warmedRef.current = true;
    if (isWebGLAvailable()) {
      try {
        warmUpSiriShaders();
      } catch {
        // warm-up is best-effort.
      }
    }
  }

  // `voice://orb-phase` listener — the main window's useVoiceInput store
  // emits this on every phase change (Tauri windows are separate JS realms;
  // the store does NOT sync across them). Local React state mirrors the
  // payload so the canvas can read phase + trigger synchronously.
  useEffect(() => {
    if (!isTauri()) return;
    let unlistenPhase: (() => void) | undefined;
    let unlistenLevel: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      // Assert the NSPanel topmost level on mount (mirrors PetBubbleApp /
      // PetPanelApp — the level persists across show/hide for the window's
      // lifetime). Also make the native surface transparent (the conf
      // `transparent: true` is necessary but not sufficient on all macOS
      // builds — see `commands::pet_make_transparent` doc for theWKWebView
      // drawsBackground fix).
      try {
        await invoke('pet_set_topmost_level', { label: 'voice-orb' });
      } catch {
        // Non-fatal (non-macOS / window not ready).
      }
      try {
        await invoke('pet_make_transparent', { label: 'voice-orb' });
      } catch {
        // Non-fatal.
      }

      try {
        unlistenPhase = await listen<OrbPhasePayload>('voice://orb-phase', (e) => {
          const p = e.payload?.phase;
          const t = e.payload?.trigger;
          if (typeof p === 'string') {
            setPhase(p);
            orbPhaseHeardRef.current = true;
          }
          if (t === 'hotkey' || t === 'button' || t === null) {
            setTrigger(t);
          }
        });
      } catch (err) {
        console.warn('[voice-orb] orb-phase listener setup failed:', err);
      }
      try {
        unlistenLevel = await listen<{ level: number }>('voice://mic-level', (e) => {
          const v = e.payload?.level;
          if (typeof v === 'number' && Number.isFinite(v)) {
            setLevel(Math.min(1, Math.max(0, v)));
          }
        });
      } catch (err) {
        console.warn('[voice-orb] mic-level listener setup failed:', err);
      }
      if (cancelled) {
        unlistenPhase?.();
        unlistenLevel?.();
      }
    })();

    return () => {
      cancelled = true;
      unlistenPhase?.();
      unlistenLevel?.();
    };
  }, []);

  // Hide the window when the phase returns to idle OR error. Rust shows the
  // window on `voice_start`; the transcribe/polish/insert phases are
  // frontend-only, so the frontend must own the hide (Rust has no visibility
  // into them). The invoke is fire-and-forget — a missing window is a no-op.
  useEffect(() => {
    if (phase !== 'idle' && phase !== 'error') return;
    if (!isTauri()) return;
    // Suppress the very-first idle emit: the orb window starts at 'idle' in
    // its own realm and we don't want to hide a window that isn't shown yet
    // (harmless, but it spams the log on mount before any phase event lands).
    if (!orbPhaseHeardRef.current) return;
    void invoke('voice_orb_hide').catch(() => {});
  }, [phase]);

  // The orb is the hotkey path's recording indicator. The mic-button path
  // uses the button body itself (red bg + stop square) — its trigger is
  // 'button', so we render nothing here and let the window body stay
  // transparent (the user only asked for the cross-app hotkey animation).
  if (trigger !== 'hotkey') return <></>;
  if (!phaseToVisible(phase)) return <></>;

  const isOrb = phase === 'transcribing' || phase === 'polishing' || phase === 'inserting';
  const merging = phase === 'inserting';

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        width: STAGE_WIDTH,
        height: STAGE_HEIGHT,
        pointerEvents: 'none',
      }}
      aria-hidden
    >
      <SiriGL
        mode={isOrb ? 'orb' : 'wave'}
        level={isOrb ? 0 : level}
        resolved={!isOrb}
        speed={isOrb ? 1.5 : 1.0}
        merging={merging}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
      />
    </div>
  );
}
