import { useVoiceInput } from '@/hooks/useVoiceInput';
import { isTauri } from '@/utils/platform';

// ponytail: pure presentational — the recording state machine + polish +
// insert flow lives in `useVoiceInput` (shared with the global-hotkey
// listener in App.tsx). Disabled with a tooltip on non-macOS. When a
// permission error fires (mic / speech recognition / accessibility), a
// "打开系统设置" link opens the matching System Settings pane via
// `tauri-plugin-shell`'s `open()`. The OS shows its own first-run prompt;
// this is the recovery path for a denied/revoked permission.
//
// Recording indicator: the button ITSELF transforms into a stop affordance
// while `phase === 'recording'` — red filled bg + white stop square (■) +
// `animate-pulse`. The stop square is universally understood, and making
// the whole button the click target means there is no separate pill to
// misaim at. The button stays ENABLED during recording so click-to-stop
// works (bug #1 root cause: `phase !== 'idle'` disabled it mid-recording,
// stranding the user). Busy phases (transcribing/polishing/inserting) stay
// disabled — interrupting those would corrupt the flow.

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
  const recording = phase === 'recording';
  const busy = phase === 'transcribing' || phase === 'polishing' || phase === 'inserting';
  // Bug #1 fix: enable the button while recording (click = stop). Only busy
  // phases disable it. `!mac` + `disabled` prop stay hard-disabled.
  const isDisabled = disabled || !mac || busy;

  // Click-to-toggle: idle → start, recording → stop. The hook guards against
  // double-start / double-stop internally.
  const handleToggle = () => {
    if (phase === 'idle') void start();
    else if (phase === 'recording') void stop();
  };

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
        className={`w-7 h-7 flex items-center justify-center rounded-md transition-all duration-[120ms] disabled:opacity-40 disabled:cursor-not-allowed border-none cursor-pointer ${
          recording
            ? 'bg-red text-white animate-pulse'
            : phase === 'error'
              ? 'text-red bg-transparent hover:bg-hov'
              : 'text-t3 bg-transparent hover:bg-hov hover:text-t1'
        }`}
        onClick={handleToggle}
        disabled={isDisabled}
        title={title}
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
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="2" width="6" height="12" rx="3" />
            <path d="M5 10a7 7 0 0 0 14 0" />
            <line x1="12" y1="17" x2="12" y2="22" />
          </svg>
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
    </span>
  );
}
