import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useVoiceStore, DEFAULT_POLISH_PROMPT, SPOKEN_LANGUAGES } from '@/store/voiceStore';
import { isTauri } from '@/utils/platform';
import { invoke } from '@tauri-apps/api/core';
import { Toggle } from '@/components/settings/primitives';
import { useHotkeyRecording } from '@/components/settings/useHotkeyRecording';
import { ThemeIcon } from '@/components/icons/ThemeIcon';

function Row({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="tr flex items-center justify-between py-3.5 border-b border-brd">
      <div className="tr-info">
        <h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-1">{title}</h4>
        {desc && <p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 m-0 leading-relaxed">{desc}</p>}
      </div>
      {children}
    </div>
  );
}

type PermState = 'idle' | 'checking' | 'granted' | 'denied';

/// One macOS permission row with a state-machine button (idle → checking →
/// granted/denied). Reused for accessibility + mic + speech so the three
/// affordances stay visually + behaviorally identical.
/// ponytail: extracted at the third consumer — the inline JSX was triplicated.
function PermissionRow({ title, desc, idleLabel, state, onClick }: {
  title: string; desc: string; idleLabel: string; state: PermState; onClick: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Row title={title} desc={desc}>
      <button
        className="btn btn-g btn-sm"
        disabled={state === 'checking'}
        onClick={onClick}
      >
        {state === 'checking'
          ? t('settings:voice.permission.checking')
          : state === 'granted'
            ? t('settings:voice.permission.granted')
            : state === 'denied'
              ? t('settings:voice.permission.denied')
              : idleLabel}
      </button>
    </Row>
  );
}

/**
 * Push-to-talk hotkey recorder. Captures a modifier+key combo via the next
 * keydown event, converts it to a Tauri accelerator string (`Cmd+Shift+V`),
 * and persists it to `voiceStore.globalHotkey`. An empty combo (Esc) clears
 * the hotkey. Re-registers with the OS via `voice_set_global_hotkey` so the
 * new combo takes effect system-wide immediately.
 *
 * Recording mechanics (capture-phase keydown listener, click-outside cancel)
 * live in `useHotkeyRecording`, shared with `ShortcutEditor`. This shell owns
 * the voice-specific bits: the accelerator-string keyshape, `setGlobalHotkey`
 * persistence, Esc-clears semantics, and `voice_set_global_hotkey` re-register.
 * Voice doesn't surface a conflict-occupied hint, so `conflictTimeoutMs` is
 * omitted (unlike ShortcutEditor's 2500ms) — the hook degrades to no-timeout.
 */
function VoiceHotkeyRecorder() {
  const { t } = useTranslation();
  const globalHotkey = useVoiceStore((s) => s.globalHotkey);
  const setGlobalHotkey = useVoiceStore((s) => s.setGlobalHotkey);

  const onCapture = useCallback((event: KeyboardEvent) => {
    // Esc clears the hotkey (unregister). Esc isn't a lone modifier, so the
    // hook routes it through onCapture — handle before building the combo.
    if (event.key === 'Escape') {
      setGlobalHotkey('');
      return;
    }

    const tokens: string[] = [];
    if (event.metaKey) tokens.push('Cmd');
    if (event.ctrlKey) tokens.push('Control');
    if (event.altKey) tokens.push('Alt');
    if (event.shiftKey) tokens.push('Shift');
    // Single-letter keys uppercased; multi-char (F5, Space, Enter) passthrough.
    const k = event.key.length === 1 ? event.key.toUpperCase() : event.key;
    tokens.push(k);

    const accelerator = tokens.join('+');
    setGlobalHotkey(accelerator);

    // Re-register with the OS so the new combo takes effect immediately.
    if (isTauri()) {
      void (async () => {
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          await invoke('voice_set_global_hotkey', { accelerator });
          console.info('[voice] hotkey re-registered:', accelerator);
        } catch (err) {
          console.warn('[voice] failed to re-register hotkey:', err);
        }
      })();
    }
  }, [setGlobalHotkey]);

  const { recording, start, containerRef } = useHotkeyRecording(onCapture);

  return (
    <div ref={containerRef} className="sk-keys flex items-center gap-[3px] cursor-pointer" onClick={start}>
      {recording ? (
        <span className="key bg-accdim border border-acc text-acc rounded px-1.5 py-0.5 text-[10.5px] font-mono shadow-[0_1px_0_var(--brd2)]">{t('settings:voice.globalHotkey.recording')}</span>
      ) : globalHotkey ? (
        <span className="key bg-surf2 border border-brd2 rounded px-1.5 py-0.5 text-[10.5px] font-mono text-t1 shadow-[0_1px_0_var(--brd2)]">{globalHotkey}</span>
      ) : (
        <span className="text-t3 text-[10.5px]">{t('settings:voice.globalHotkey.notSet')}</span>
      )}
    </div>
  );
}

export function VoiceSettings() {
  const { t } = useTranslation();
  const polishPrompt = useVoiceStore((s) => s.polishPrompt);
  const autoPolish = useVoiceStore((s) => s.autoPolish);
  const autoPaste = useVoiceStore((s) => s.autoPaste);
  const saveSource = useVoiceStore((s) => s.saveSource);
  const sourceDir = useVoiceStore((s) => s.sourceDir);
  const spokenLanguage = useVoiceStore((s) => s.spokenLanguage);

  const setPolishPrompt = useVoiceStore((s) => s.setPolishPrompt);
  const setAutoPolish = useVoiceStore((s) => s.setAutoPolish);
  const setAutoPaste = useVoiceStore((s) => s.setAutoPaste);
  const setSaveSource = useVoiceStore((s) => s.setSaveSource);
  const setSourceDir = useVoiceStore((s) => s.setSourceDir);
  const setSpokenLanguage = useVoiceStore((s) => s.setSpokenLanguage);

  const onMac = isTauri() && typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);

  // macOS permission affordances: each is an explicit "trigger the system prompt"
  // button (mirrors openless — prompts fire from explicit user actions, not hot
  // paths). The voice hot path (`voice_start`) does NOT prompt for mic/speech
  // from here; it has its own `ensure_*` guards. These rows let the user grant
  // BEFORE the first recording, and re-check status after toggling in System
  // Settings. State: 'idle' | 'checking' | 'granted' | 'denied'.
  const [axState, setAxState] = useState<PermState>('idle');
  const [micState, setMicState] = useState<PermState>('idle');
  const [speechState, setSpeechState] = useState<PermState>('idle');

  const requestPerm = useCallback(
    async (cmd: string, setState: (s: PermState) => void) => {
      if (!onMac) return;
      setState('checking');
      try {
        const granted = await invoke<boolean>(cmd);
        setState(granted ? 'granted' : 'denied');
      } catch (err) {
        console.warn(`[voice] request ${cmd} failed:`, err);
        setState('denied');
      }
    },
    [onMac],
  );

  return (
    <div className="mb-8 whitespace-nowrap">
      <div className="pb-3 mb-5 border-b border-brd2 flex items-baseline gap-2">
        <div className="text-[length:calc(var(--ui-font-size)+3px)] font-bold text-t1 tracking-[-0.01em]">{t('settings:voice.title')}</div>
        <div className="text-[length:calc(var(--ui-font-size)-1px)] text-t3 flex items-center gap-1">
          {(() => {
            const desc = t('settings:voice.description');
            const idx = desc.indexOf('🎤');
            if (idx < 0) return <>{desc}{!onMac && t('settings:voice.windowsUnsupported')}</>;
            const before = desc.slice(0, idx);
            const after = desc.slice(idx + 2);
            return <>{before}<ThemeIcon name="cwmMicOn" size={12} className="inline-block align-middle" />{after}{!onMac && t('settings:voice.windowsUnsupported')}</>;
          })()}
        </div>
      </div>

      {!onMac && (
        <div className="mb-3.5 px-3 py-2 rounded-md border border-brd bg-surf text-[length:calc(var(--ui-font-size)-2.5px)] text-t3">
          {t('settings:voice.windowsUnsupportedBanner')}
        </div>
      )}

      {onMac && (
        <>
          <PermissionRow
            title={t('settings:voice.microphone.title')}
            desc={t('settings:voice.microphone.desc')}
            idleLabel={t('settings:voice.microphone.action')}
            state={micState}
            onClick={() => void requestPerm('voice_request_microphone', setMicState)}
          />
        </>
      )}

      <Row title={t('settings:voice.saveSource.title')} desc={t('settings:voice.saveSource.desc')}>
        <Toggle value={saveSource} onChange={setSaveSource} />
      </Row>

      {saveSource && (
        <div className="py-3.5 border-b border-brd">
          <h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-1">{t('settings:voice.sourceDir.label')}</h4>
          <p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 m-0 mb-2 leading-relaxed">{t('settings:voice.sourceDir.desc')}</p>
          <input
            className="w-full h-[34px] py-[7px] px-2.5 rounded-md border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui transition-[border-color] duration-100 focus:border-acc"
            value={sourceDir}
            onChange={(e) => setSourceDir(e.target.value)}
            placeholder=".voice_input"
          />
        </div>
      )}

      {onMac && (
        <PermissionRow
          title={t('settings:voice.speech.title')}
          desc={t('settings:voice.speech.desc')}
          idleLabel={t('settings:voice.speech.action')}
          state={speechState}
          onClick={() => void requestPerm('voice_request_speech', setSpeechState)}
        />
      )}

      <div className="py-3.5 border-b border-brd">
        <h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-1">{t('settings:voice.spokenLanguage.label')}</h4>
        <p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 m-0 mb-2 leading-relaxed">{t('settings:voice.spokenLanguage.desc')}</p>
        <select
          className="w-full h-[34px] py-[7px] px-2.5 rounded-md border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui transition-[border-color] duration-100 focus:border-acc"
          value={spokenLanguage}
          onChange={(e) => setSpokenLanguage(e.target.value)}
        >
          {SPOKEN_LANGUAGES.map((lang) => (
            <option key={lang.value} value={lang.value}>{lang.label}</option>
          ))}
        </select>
      </div>

      <Row title={t('settings:voice.autoPolish.title')} desc={t('settings:voice.autoPolish.desc')}>
        <Toggle value={autoPolish} onChange={setAutoPolish} />
      </Row>

      {autoPolish && (
        <div className="py-3.5 border-b border-brd">
          <h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-1">{t('settings:voice.polishPrompt.label')}</h4>
          <p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 m-0 mb-2 leading-relaxed">{t('settings:voice.polishPrompt.desc')}</p>
          <textarea
            className="w-full py-2 px-2.5 rounded-md border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui transition-[border-color] duration-100 focus:border-acc"
            rows={8}
            value={polishPrompt}
            onChange={(e) => setPolishPrompt(e.target.value)}
            placeholder={DEFAULT_POLISH_PROMPT}
          />
          <div className="flex justify-between items-center mt-1.5">
            <span className="text-[length:calc(var(--ui-font-size)-3px)] text-t3">{t('settings:voice.polishPrompt.charCount', { count: polishPrompt.length })}</span>
            <button
              className="text-[length:calc(var(--ui-font-size)-2.5px)] text-t3 hover:text-acc bg-transparent border-none cursor-pointer underline-offset-2 hover:underline"
              onClick={() => setPolishPrompt(DEFAULT_POLISH_PROMPT)}
            >{t('settings:voice.polishPrompt.reset')}</button>
          </div>
        </div>
      )}

      <Row title={t('settings:voice.autoPaste.title')} desc={t('settings:voice.autoPaste.desc')}>
        <Toggle value={autoPaste} onChange={setAutoPaste} />
      </Row>

      {onMac && autoPaste && (
        <PermissionRow
          title={t('settings:voice.accessibility.title')}
          desc={t('settings:voice.accessibility.desc')}
          idleLabel={t('settings:voice.accessibility.action')}
          state={axState}
          onClick={() => void requestPerm('voice_request_accessibility', setAxState)}
        />
      )}

      <div className="py-3.5 border-b border-brd">
        <h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-1">{t('settings:voice.globalHotkey.label')}</h4>
        <p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 m-0 mb-2 leading-relaxed">{t('settings:voice.globalHotkey.desc')}</p>
        <VoiceHotkeyRecorder />
      </div>
    </div>
  );
}
