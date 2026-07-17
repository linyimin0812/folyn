import type { CSSProperties } from 'react';
import { useVoiceInput } from '@/hooks/useVoiceInput';
import { isTauri } from '@/utils/platform';

// ponytail: pure presentational now — the recording state machine + polish +
// insert flow lives in `useVoiceInput` (shared with the global-hotkey
// listener in App.tsx). Disabled with a tooltip on non-macOS. When a
// permission error fires (mic / speech recognition / accessibility), a
// "打开系统设置" link opens the matching System Settings pane via
// `tauri-plugin-shell`'s `open()`. The OS shows its own first-run prompt;
// this is the recovery path for a denied/revoked permission.
//
// Recording indicator: a floating "正在录音…" pill below the mic button with
// 3 animated equalizer bars. CSS-only (no RMS plumbing). The recorder DOES
// compute per-callback RMS (`voice/recorder.rs::quantize_to_i16_le` returns
// it, currently discarded as `_output_rms`); wiring it through would need a
// Tauri event (`voice://level`) emitted from the recorder thread + a
// frontend listener driving bar heights — >30 lines of new plumbing, skipped
// for the visibility fix. Upgrade path: add `AppHandle` to the recorder
// thread, emit `voice://level` with the RMS each callback, listen here and
// scale the bar `height` inline. The bars would then reflect actual audio.

// Inject the equalizer keyframes once per document. Idempotent — the
// `data-voice-keyframes` marker guards re-injection in StrictMode / HMR.
function ensureRecordingKeyframes(): void {
  if (typeof document === 'undefined') return;
  if (document.head.querySelector('style[data-voice-keyframes]')) return;
  const style = document.createElement('style');
  style.setAttribute('data-voice-keyframes', '1');
  style.textContent = `
@keyframes quill-voice-eq {
  0%, 100% { transform: scaleY(0.35); }
  50%      { transform: scaleY(1); }
}
`;
  document.head.appendChild(style);
}

function onMac(): boolean {
  return isTauri() && typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);
}

/** Map an error message to the System Settings deep-link URL for the
 *  permission it names. Returns null when the error isn't a permission
 *  denial (no link to show). Matched on stable prefixes from the Rust
 *  strings in `voice.rs` / `apple_speech.rs` / `insertion.rs`. */
function permissionSettingsUrl(msg: string): string | null {
  if (msg.includes('麦克风')) {
    return 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone';
  }
  if (msg.includes('语音识别')) {
    return 'x-apple.systempreferences:com.apple.preference.security?Privacy_SpeechRecognition';
  }
  if (msg.includes('辅助功能')) {
    return 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility';
  }
  return null;
}

async function openSystemSettings(url: string): Promise<void> {
  try {
    const { open } = await import('@tauri-apps/plugin-shell');
    await open(url);
  } catch (err) {
    console.warn('[voice] open system settings failed:', err);
  }
}

export function VoiceInputButton({ disabled }: { disabled?: boolean }) {
  const phase = useVoiceInput((s) => s.phase);
  const error = useVoiceInput((s) => s.error);
  const start = useVoiceInput((s) => s.start);
  const stop = useVoiceInput((s) => s.stop);

  const mac = onMac();
  const isDisabled = disabled || !mac || phase !== 'idle';

  // Click-to-toggle: idle → start, recording → stop. The hook guards against
  // double-start / double-stop internally.
  const handleToggle = () => {
    if (phase === 'idle') void start();
    else if (phase === 'recording') void stop();
  };

  const recording = phase === 'recording';
  const busy = phase === 'transcribing' || phase === 'polishing' || phase === 'inserting';
  const settingsUrl = phase === 'error' && error ? permissionSettingsUrl(error) : null;

  const title = !mac
    ? 'Windows 暂不支持语音输入'
    : recording
      ? '点击停止录音并插入'
      : busy
        ? '语音处理中…'
        : phase === 'error' && error
          ? error
          : '语音输入';

  return (
    <span className="relative inline-flex">
      <button
        className={`w-7 h-7 flex items-center justify-center rounded-md transition-all duration-[120ms] disabled:opacity-40 disabled:cursor-not-allowed bg-transparent border-none cursor-pointer ${
          recording
            ? 'text-red'
            : phase === 'error'
              ? 'text-red'
              : 'text-t3 hover:bg-hov hover:text-t1'
        }`}
        onClick={handleToggle}
        disabled={isDisabled || busy}
        title={title}
        aria-label="语音输入"
      >
        {busy ? (
          // Spinner while transcribing / polishing / inserting.
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="animate-spin">
            <path d="M8 1.5a6.5 6.5 0 1 0 6.5 6.5" strokeLinecap="round" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="2" width="6" height="12" rx="3" />
            <path d="M5 10a7 7 0 0 0 14 0" />
            <line x1="12" y1="17" x2="12" y2="22" />
          </svg>
        )}
      </button>
      {recording && <RecordingPill />}
      {settingsUrl && (
        // Inline "打开系统设置" link below the mic icon, shown only on a
        // permission error. Clicking opens the matching System Settings
        // pane. The error auto-clears after 3s (hook timer), so the link
        // disappears with it.
        <span
          className="absolute top-full left-1/2 -translate-x-1/2 mt-0.5 text-[10px] text-acc whitespace-nowrap cursor-pointer hover:underline z-10"
          role="link"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            void openSystemSettings(settingsUrl);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              e.stopPropagation();
              void openSystemSettings(settingsUrl);
            }
          }}
        >
          打开系统设置
        </span>
      )}
    </span>
  );
}

/** Floating "正在录音…" pill with 3 animated equalizer bars. Sits below the
 *  mic button while `phase === 'recording'`. `pointer-events-none` so it
 *  never steals the click that stops recording. Animation is the CSS
 *  `quill-voice-eq` keyframes (injected at module load); each bar gets a
 *  different `animationDelay` so the bars don't pulse in lockstep. */
function RecordingPill() {
  ensureRecordingKeyframes();
  // Inline background/border via `color-mix` — `--red` is a hex CSS var so the
  // Tailwind `/10` opacity modifier won't work on `bg-red`. Matches the
  // `.diff-btn-reject` repo convention (index.css line 227).
  const pillStyle: CSSProperties = {
    background: 'color-mix(in srgb, var(--red, #f06a6a) 12%, transparent)',
    border: '1px solid color-mix(in srgb, var(--red, #f06a6a) 30%, transparent)',
  };
  return (
    <span
      className="absolute top-full left-1/2 -translate-x-1/2 mt-1 flex items-center gap-1.5 px-2 py-1 rounded-full text-red text-[10px] whitespace-nowrap pointer-events-none z-10 select-none"
      style={pillStyle}
      role="status"
      aria-live="polite"
    >
      <span className="flex items-end gap-[2px] h-2.5">
        {[0, 0.25, 0.5].map((delay) => (
          <span
            key={delay}
            className="w-[2px] h-2.5 bg-red origin-bottom"
            style={{
              animation: 'quill-voice-eq 0.9s ease-in-out infinite',
              animationDelay: `${delay}s`,
            }}
          />
        ))}
      </span>
      正在录音…
    </span>
  );
}
