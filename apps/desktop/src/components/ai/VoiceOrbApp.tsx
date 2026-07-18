// VoiceOrbApp — the SiriGL waveform host mounted in the `voice-orb` Tauri
// window (transparent, always-on-top, nonactivating NSPanel — declared in
// tauri.conf.json `voice-orb` and converted in `pet_panel_macos::convert_windows`).
//
// This is the recording indicator for BOTH trigger paths: the global voice
// hotkey (cross-app, when another app like VS Code / browser has focus) AND
// the AI panel mic button. Both paths show the same bottom-center SiriGL
// animation. The Rust `voice_start` command shows the window unconditionally
// regardless of trigger (see `voice::show_voice_orb`); this frontend owns the
// HIDE (via `invoke('voice_orb_hide')`) because the
// transcribing/polishing/inserting phases are frontend-only state — Rust has
// no visibility into them.
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
import type { VoicePhase, PolishSkippedReason } from '@/hooks/useVoiceInput';
import { SiriGL, isWebGLAvailable, warmUpSiriShaders } from './SiriGL';

interface OrbPhasePayload {
  phase: VoicePhase;
  polishSkippedReason?: PolishSkippedReason;
}

/** Phase → caption label. Surfaced at the bottom of the orb window so the
 *  user can read which stage the flow is in. `recording` has no caption
 *  (the live waveform IS the indicator); the rest get a one-line label. */
function phaseCaption(phase: VoicePhase): string | null {
  switch (phase) {
    case 'transcribing':
      return '语音转文字中…';
    case 'polishing':
      return 'LLM 优化中…';
    case 'inserting':
      return '插入中…';
    default:
      return null;
  }
}

/** Emit `pet://menu-action` `open-ai-settings` so the main window's listener
 *  (usePetHostBridge → routePetMenuAction) sets navStore to Settings → AI tab
 *  and focuses the main window. The orb is a separate Tauri window = separate
 *  JS realm, so it cannot touch the main window's navStore directly; it must
 *  hop through the `pet://menu-action` channel and let the main window route. */
async function openAiSettingsFromOrb(): Promise<void> {
  if (!isTauri()) return;
  try {
    const { emit } = await import('@tauri-apps/api/event');
    await emit('pet://menu-action', { action: 'open-ai-settings' });
  } catch (err) {
    console.warn('[voice-orb] emit open-ai-settings failed:', err);
  }
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
  const [level, setLevel] = useState(0);
  const [polishSkippedReason, setPolishSkippedReason] = useState<PolishSkippedReason>(null);
  // voice-orb is a separate Tauri window = separate JS realm; the main
  // window's useAppearanceStore does NOT sync here. Use OS prefers-color-scheme
  // directly so the caption stays legible on both light and dark desktops.
  // Default true (dark): white-on-dark shadow survives more desktop backgrounds
  // than the reverse when matchMedia is unavailable.
  const [isDark, setIsDark] = useState<boolean>(() =>
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : true,
  );
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setIsDark(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
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
  // payload so the canvas can read phase synchronously.
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
          if (typeof p === 'string') {
            setPhase(p);
            orbPhaseHeardRef.current = true;
          }
          setPolishSkippedReason(e.payload?.polishSkippedReason ?? null);
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

  // Both button and hotkey triggers render the orb. The mic-button path
  // ALSO shows its own button-body feedback (red bg + stop square / spinner)
  // — that's an independent channel and coexists with this window's animation.
  if (!phaseToVisible(phase)) return <></>;

  const isOrb = phase === 'transcribing' || phase === 'polishing' || phase === 'inserting';
  const merging = phase === 'inserting';
  const caption = phaseCaption(phase);
  const captionColor = isDark ? '#fff' : '#1a1a1a';
  const captionShadow = isDark
    ? '0 1px 4px rgba(0,0,0,0.6)'
    : '0 1px 4px rgba(255,255,255,0.8), 0 0 1px rgba(0,0,0,0.4)';
  const linkColor = isDark ? '#7AB7FF' : '#0066CC';

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
      {/* ponytail: caption is a pointer-events-none overlay; the
          "打开设置" link re-enables pointerEvents on itself. NSPanel is
          non-activating + focus:false — if clicks don't register here on
          some macOS builds, fall back to reading the text and opening
          Settings from the in-panel mic button. Upgrade path: register a
          dedicated Tauri command (voice_open_ai_settings) that focuses
          main + sets navStore in one Rust-side step if the
          `open-ai-settings` emit proves flaky. */}
      {caption && (
        <div
          style={{
            position: 'absolute',
            bottom: 8,
            left: 0,
            right: 0,
            textAlign: 'center',
            color: captionColor,
            fontSize: 12,
            textShadow: captionShadow,
            userSelect: 'none',
          }}
        >
          {caption}
          {polishSkippedReason === 'no-api-key' && (
            <div style={{ marginTop: 2 }}>
              <span style={{ opacity: 0.9 }}>未配置 API Key，跳过 LLM 优化</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void openAiSettingsFromOrb();
                }}
                style={{
                  pointerEvents: 'auto',
                  marginLeft: 6,
                  background: 'transparent',
                  border: 'none',
                  color: linkColor,
                  fontSize: 12,
                  cursor: 'pointer',
                  textDecoration: 'underline',
                }}
              >
                打开设置
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
