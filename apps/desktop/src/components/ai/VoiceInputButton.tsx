import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useVoiceInput } from '@/hooks/useVoiceInput';
import { isVoiceSupportedPlatform, isMacPlatform } from '@/utils/shellSidecar';
import { ThemeIcon } from '@/components/icons/ThemeIcon';
import { isWebGLAvailable } from './SiriGL';

// ponytail: pure presentational — the recording state machine + polish +
// insert flow lives in `useVoiceInput` (shared with the global-hotkey
// listener in App.tsx). Disabled with a tooltip on non-macOS. Permission
// errors (mic / speech recognition / accessibility) and the "未配置 API Key"
// prompt surface only as a red button + tooltip text in the AI panel; the
// inline "打开系统设置" / "打开设置" links live exclusively in the voice-orb
// window (VoiceOrbApp.tsx, separate Tauri window), so this component hosts
// no settings navigation.
//
// Recording indicator: the mic button body itself (red bg + white stop
// square) is the SOLE indicator for the in-AI-panel mic-button path. The
// cross-app hotkey path's indicator is the separate `voice-orb` Tauri
// window (VoiceOrbApp.tsx) — shown by Rust on `voice_start`, hidden by the
// orb's own frontend on idle/error. This component no longer hosts the
// SiriGL overlay; the previous in-panel `VoiceOrbOverlay` is removed (the
// user explicitly asked for the animation to show even when Folyn has no
// focus).
//
// WebGL-unavailable fallback: the `.voice-ring` / `.voice-glow` CSS classes
// stay in index.css; if WebGL is unavailable in the voice-orb window, the
// orb's own VoiceOrbApp will surface a fallback (TODO). For the mic-button
// path the CSS ring stays as the in-panel fallback when WebGL is missing.

// ponytail: voice is macOS-only for now (Windows support temporarily hidden
// in `isVoiceSupportedPlatform`; Rust voice module is still cfg-gated to
// macOS). `isVoiceSupportedPlatform` gates the button; `isMacPlatform` gates
// the macOS-only SiriGL overlay path (non-mac platforms fall back to the CSS
// ring indicator). Both helpers live in shellSidecar.ts so VoiceInputButton /
// useVoiceInput / VoiceSettings share one source of truth.

export function VoiceInputButton({ disabled }: { disabled?: boolean }) {
  const { t } = useTranslation();
  const phase = useVoiceInput((s) => s.phase);
  const error = useVoiceInput((s) => s.error);
  const trigger = useVoiceInput((s) => s.trigger);
  const start = useVoiceInput((s) => s.start);
  const stop = useVoiceInput((s) => s.stop);

  // ponytail: probe WebGL once on mount; the result gates the SiriGL overlay
  // vs the CSS-ring fallback. Stored in state so a late probe resolution
  // re-renders; the probe itself is synchronous in practice (jsdom returns
  // null → false; real browsers return a context immediately).
  const [glAvailable, setGlAvailable] = useState<boolean>(() =>
    typeof document !== 'undefined' ? isWebGLAvailable() : false,
  );
  useEffect(() => {
    if (glAvailable) return;
    const id = setTimeout(() => setGlAvailable(isWebGLAvailable()), 0);
    return () => clearTimeout(id);
  }, [glAvailable]);

  const voiceSupported = isVoiceSupportedPlatform();
  const isMac = isMacPlatform();
  const recording = phase === 'recording';
  const busy = phase === 'transcribing' || phase === 'polishing' || phase === 'inserting';
  // Bug #1 fix: enable the button while recording (click = stop). Only busy
  // phases disable it. `!voiceSupported` + `disabled` prop stay hard-disabled.
  const isDisabled = disabled || !voiceSupported || busy;

  // Click-to-toggle: idle → start, recording → stop. The hook guards against
  // double-start / double-stop internally. Label this entry point 'button'
  // so the voice-orb window suppresses its animation (orb is hotkey-only —
  // the mic-button path uses the button body itself as the indicator).
  const handleToggle = () => {
    if (phase === 'idle') void start('button');
    else if (phase === 'recording') void stop();
  };

  // Phase-specific busy label so the user can read which stage the flow is
  // in (was a generic "语音处理中…" before). saveError from a non-fatal
  // source-save failure still takes priority (matches the prior behavior).
  const busyLabel =
    phase === 'transcribing'
      ? t('ai:voice.phase.transcribing')
      : phase === 'polishing'
        ? t('ai:voice.phase.polishing')
        : phase === 'inserting'
          ? t('ai:voice.phase.inserting')
          : t('ai:voice.phase.processing');

  const title = !voiceSupported
    ? t('ai:voice.button.windowsUnsupported')
    : recording
      ? t('ai:voice.button.clickToStop')
      : busy && error
        ? error
        : busy
          ? busyLabel
          : phase === 'error' && error
            ? error
            : t('ai:voice.button.idle');

  return (
    <span className="relative inline-flex">
      {/* ponytail: macOS gates the SiriGL overlay on WebGL availability;
          Windows (and any other supported non-mac platform) always falls back
          to the CSS ring — no orb / no SiriGL on Windows in R15 MVP. */}
      {recording && (!isMac || !glAvailable) && trigger === 'hotkey' && (
        // ponytail: fallback ring (openless panel-context variant) — only
        // rendered when WebGL is unavailable OR we're not on macOS. The
        // `.voice-ring` / `.voice-glow` CSS classes stay in index.css so this
        // branch activates instantly without a code change if the WebGL probe
        // ever returns false at runtime (e.g. user disabled hardware accel).
        // The voice-orb Tauri window (separate JS realm) renders its own
        // fallback inside the orb when WebGL is missing there.
        <>
          <span aria-hidden className="voice-glow" />
          <span aria-hidden className="voice-ring" />
        </>
      )}
      <button
        className={`relative w-7 h-7 flex items-center justify-center rounded-md transition-all duration-[120ms] disabled:opacity-40 disabled:cursor-not-allowed border-none cursor-pointer ${
          recording
            ? 'bg-red text-white'
            : phase === 'error'
              ? 'text-red bg-transparent hover:bg-hov'
              : phase === 'polishing'
                ? 'text-acc bg-transparent hover:bg-hov'
                : 'text-t3 bg-transparent hover:bg-hov hover:text-t1'
        }`}
        onClick={handleToggle}
        onMouseDown={(e) => e.preventDefault()}
        disabled={isDisabled}
        title={title}
        tabIndex={-1}
        aria-label={recording ? t('ai:voice.button.stopRecordingLabel') : t('ai:voice.button.voiceInputLabel')}
      >
        {busy ? (
          // Spinner while transcribing / polishing / inserting.
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="animate-spin">
            <path d="M8 1.5a6.5 6.5 0 1 0 6.5 6.5" strokeLinecap="round" />
          </svg>
        ) : recording ? (
          // White stop square — universally understood stop affordance.
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
        ) : (
          <ThemeIcon name="cwmMicOn" size={16} />
        )}
      </button>
    </span>
  );
}
