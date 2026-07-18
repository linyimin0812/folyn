import { useEffect, useState } from 'react';
import { useVoiceInput } from '@/hooks/useVoiceInput';
import { useNavStore } from '@/store/navStore';
import { isTauri } from '@/utils/platform';
import { ThemeIcon } from '@/components/icons/ThemeIcon';
import { isWebGLAvailable } from './SiriGL';

// ponytail: pure presentational — the recording state machine + polish +
// insert flow lives in `useVoiceInput` (shared with the global-hotkey
// listener in App.tsx). Disabled with a tooltip on non-macOS. When a
// permission error fires (mic / speech recognition / accessibility), a
// "打开系统设置" link opens the matching System Settings pane via
// `tauri-plugin-shell`'s `open()`. The OS shows its own first-run prompt;
// this is the recovery path for a denied/revoked permission.
//
// Recording indicator: the mic button body itself (red bg + white stop
// square) is the SOLE indicator for the in-AI-panel mic-button path. The
// cross-app hotkey path's indicator is the separate `voice-orb` Tauri window
// (VoiceOrbApp.tsx) — shown by Rust on `voice_start`, hidden by the orb's
// own frontend on idle/error. This component no longer hosts the SiriGL
// overlay; the previous in-panel `VoiceOrbOverlay` is removed (the user
// explicitly asked for the animation to show even when Quill has no focus).
//
// WebGL-unavailable fallback: the `.voice-ring` / `.voice-glow` CSS classes
// stay in index.css; if WebGL is unavailable in the voice-orb window, the
// orb's own VoiceOrbApp will surface a fallback (TODO). For the mic-button
// path the CSS ring stays as the in-panel fallback when WebGL is missing.

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
  const trigger = useVoiceInput((s) => s.trigger);
  const polishSkippedReason = useVoiceInput((s) => s.polishSkippedReason);
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

  const mac = onMac();
  const recording = phase === 'recording';
  const busy = phase === 'transcribing' || phase === 'polishing' || phase === 'inserting';
  // Bug #1 fix: enable the button while recording (click = stop). Only busy
  // phases disable it. `!mac` + `disabled` prop stay hard-disabled.
  const isDisabled = disabled || !mac || busy;

  // Click-to-toggle: idle → start, recording → stop. The hook guards against
  // double-start / double-stop internally. Label this entry point 'button'
  // so the voice-orb window suppresses its animation (orb is hotkey-only —
  // the mic-button path uses the button body itself as the indicator).
  const handleToggle = () => {
    if (phase === 'idle') void start('button');
    else if (phase === 'recording') void stop();
  };

  const settingsUrl = phase === 'error' && error ? permissionSettingsUrl(error) : null;
  const showApiKeyPrompt = polishSkippedReason === 'no-api-key' && busy;

  // Phase-specific busy label so the user can read which stage the flow is
  // in (was a generic "语音处理中…" before). saveError from a non-fatal
  // source-save failure still takes priority (matches the prior behavior).
  const busyLabel =
    phase === 'transcribing'
      ? '语音转文字中…'
      : phase === 'polishing'
        ? 'LLM 优化中…'
        : phase === 'inserting'
          ? '插入中…'
          : '语音处理中…';

  const title = !mac
    ? 'Windows 暂不支持语音输入'
    : recording
      ? '点击停止录音并插入'
      : busy && error
        ? error
        : busy
          ? busyLabel
          : phase === 'error' && error
            ? error
            : '语音输入';

  return (
    <span className="relative inline-flex">
      {recording && (!mac || !glAvailable) && trigger === 'hotkey' && (
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
        aria-label={recording ? '停止录音' : '语音输入'}
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
      {showApiKeyPrompt && !settingsUrl && (
        // Inline "打开设置" link when polish was skipped due to no chatApiKey.
        // Same visual slot as the permission link; navigates main window to
        // Settings → AI tab. The link persists for the duration of the busy
        // phase (clears on idle).
        <span
          className="absolute top-full left-1/2 -translate-x-1/2 mt-0.5 text-[10px] text-acc whitespace-nowrap cursor-pointer hover:underline z-10"
          role="link"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            useNavStore.getState().setCurrentPage('settings');
            useNavStore.getState().setSettingsTab('ai');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              e.stopPropagation();
              useNavStore.getState().setCurrentPage('settings');
              useNavStore.getState().setSettingsTab('ai');
            }
          }}
        >
          未配置 API Key · 打开设置
        </span>
      )}
    </span>
  );
}
