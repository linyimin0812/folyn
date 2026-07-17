import { useCallback, useEffect, useRef, useState } from 'react';
import { useVoiceStore, DEFAULT_POLISH_PROMPT, SPOKEN_LANGUAGES } from '@/store/voiceStore';
import { isTauri } from '@/utils/platform';

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className={`sw2 w-9 h-5 rounded-[10px] cursor-pointer relative transition-[background] duration-200 shrink-0 ${value ? 'bg-acc' : 'bg-brd2'}`} onClick={() => onChange(!value)}>
      <div className={`absolute w-4 h-4 rounded-full bg-white top-0.5 left-0.5 transition-transform duration-200 ${value ? 'translate-x-4' : ''}`} />
    </div>
  );
}

function Row({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="tr flex items-center justify-between py-2.5 border-b border-brd">
      <div className="tr-info">
        <h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-0.5">{title}</h4>
        {desc && <p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 m-0 leading-normal">{desc}</p>}
      </div>
      {children}
    </div>
  );
}

/**
 * Push-to-talk hotkey recorder. Captures a modifier+key combo via the next
 * keydown event, converts it to a Tauri accelerator string (`Cmd+Shift+V`),
 * and persists it to `voiceStore.globalHotkey`. An empty combo (Esc) clears
 * the hotkey. Re-registers with the OS via `voice_set_global_hotkey` so the
 * new combo takes effect system-wide immediately — mirrors the
 * `pet_panel_set_shortcut` re-registration in `ShortcutEditor`
 * (SettingsPage.tsx).
 *
 * ponytail: the existing `ShortcutEditor` in SettingsPage is tied to
 * `prefsStore.updateShortcut` (a keys-array shape) and isn't easily reused
 * for the voiceStore's string field. This inline recorder is the same
 * keydown-capture pattern (~30 lines) without a shared-component extraction
 * — which would require generalizing ShortcutEditor to accept a custom
 * setter + keyshape. Add when a third consumer appears.
 */
function VoiceHotkeyRecorder() {
  const globalHotkey = useVoiceStore((s) => s.globalHotkey);
  const setGlobalHotkey = useVoiceStore((s) => s.setGlobalHotkey);
  const [recording, setRecording] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    event.preventDefault();
    event.stopPropagation();

    // Esc clears the hotkey (unregister).
    if (event.key === 'Escape') {
      setGlobalHotkey('');
      setRecording(false);
      return;
    }

    // Ignore lone modifier presses — wait for the non-modifier key.
    if (['Meta', 'Control', 'Alt', 'Shift'].includes(event.key)) return;

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
    setRecording(false);

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

  useEffect(() => {
    if (!recording) return;
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [recording, handleKeyDown]);

  // Click-outside cancels recording without changing the hotkey.
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
        <span className="key bg-accdim border border-acc text-acc rounded px-1.5 py-0.5 text-[10.5px] font-mono shadow-[0_1px_0_var(--brd2)]">按下快捷键…（Esc 清除）</span>
      ) : globalHotkey ? (
        <span className="key bg-surf2 border border-brd2 rounded px-1.5 py-0.5 text-[10.5px] font-mono text-t1 shadow-[0_1px_0_var(--brd2)]">{globalHotkey}</span>
      ) : (
        <span className="text-t3 text-[10.5px]">未设置（点击录制）</span>
      )}
    </div>
  );
}

export function VoiceSettings() {
  const polishPrompt = useVoiceStore((s) => s.polishPrompt);
  const autoPolish = useVoiceStore((s) => s.autoPolish);
  const saveSource = useVoiceStore((s) => s.saveSource);
  const sourceDir = useVoiceStore((s) => s.sourceDir);
  const spokenLanguage = useVoiceStore((s) => s.spokenLanguage);

  const setPolishPrompt = useVoiceStore((s) => s.setPolishPrompt);
  const setAutoPolish = useVoiceStore((s) => s.setAutoPolish);
  const setSaveSource = useVoiceStore((s) => s.setSaveSource);
  const setSourceDir = useVoiceStore((s) => s.setSourceDir);
  const setSpokenLanguage = useVoiceStore((s) => s.setSpokenLanguage);

  const onMac = isTauri() && typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);

  return (
    <div className="mb-[26px]">
      <div className="text-[length:calc(var(--ui-font-size)+1px)] font-bold text-t1 mb-[3px] tracking-[-0.01em]">语音输入</div>
      <div className="text-[length:calc(var(--ui-font-size)-2px)] text-t3 mb-3.5">
        在 AI 聊天框点 🎤 或按全局热键开始录音,语音转文字后润色并插入到光标所在输入框(支持其他应用){!onMac && '。Windows 暂不支持语音输入'}
      </div>

      {!onMac && (
        <div className="mb-3.5 px-3 py-2 rounded-md border border-brd bg-surf text-[length:calc(var(--ui-font-size)-2.5px)] text-t3">
          当前平台暂不支持语音输入。macOS 使用 Apple Speech (SFSpeechRecognizer)。
        </div>
      )}

      <div className="mb-3.5">
        <div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-[5px] flex items-center gap-1.5">润色 Prompt</div>
        <div className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 mb-2">使用当前 AI 配置(见 AI 工具)对原始转录文本做润色。留空则跳过润色。</div>
        <textarea
          className="settings-textarea w-full"
          rows={8}
          value={polishPrompt}
          onChange={(e) => setPolishPrompt(e.target.value)}
          placeholder={DEFAULT_POLISH_PROMPT}
          style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 'calc(var(--ui-font-size) - 2px)' }}
        />
        <div className="flex justify-between items-center mt-1.5">
          <span className="text-[length:calc(var(--ui-font-size)-3px)] text-t3">{polishPrompt.length} 字符</span>
          <button
            className="text-[length:calc(var(--ui-font-size)-2.5px)] text-t3 hover:text-acc bg-transparent border-none cursor-pointer underline-offset-2 hover:underline"
            onClick={() => setPolishPrompt(DEFAULT_POLISH_PROMPT)}
          >恢复默认</button>
        </div>
      </div>

      <Row title="自动润色" desc="录音结束后自动用润色 Prompt 处理转录文本;关闭则直接输出原始转录">
        <Toggle value={autoPolish} onChange={setAutoPolish} />
      </Row>

      <Row title="保存语音源文件" desc="把录音的原始音频(WAV)保存到 vault 下的指定目录">
        <Toggle value={saveSource} onChange={setSaveSource} />
      </Row>

      <div className="mb-3.5">
        <div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-[5px] flex items-center gap-1.5">源文件目录</div>
        <div className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 mb-2">相对路径基于当前 vault 根目录;保存的文件形如 &lt;dir&gt;/&lt;timestamp&gt;.wav</div>
        <input
          className="settings-input w-full"
          value={sourceDir}
          onChange={(e) => setSourceDir(e.target.value)}
          disabled={!saveSource}
          placeholder=".voice_input"
          style={{ fontSize: 'calc(var(--ui-font-size) - 2px)' }}
        />
      </div>

      <div className="mb-3.5">
        <div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-[5px] flex items-center gap-1.5">识别语言</div>
        <div className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 mb-2">Apple Speech 引擎按语言路由识别,中文语音请选「简体中文」;系统默认 locale 可能与实际说话语言不匹配,显式指定避免转写出空。</div>
        <select
          className="settings-input w-full"
          value={spokenLanguage}
          onChange={(e) => setSpokenLanguage(e.target.value)}
          style={{ fontSize: 'calc(var(--ui-font-size) - 2px)' }}
        >
          {SPOKEN_LANGUAGES.map((lang) => (
            <option key={lang.value} value={lang.value}>{lang.label}</option>
          ))}
        </select>
      </div>

      <div className="mb-3.5">
        <div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-[5px] flex items-center gap-1.5">全局热键</div>
        <div className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 mb-2">留空则不启用全局热键;启用后按住热键即开始录音,松开结束并插入到当前焦点输入框(跨应用)。Esc 清除。</div>
        <VoiceHotkeyRecorder />
      </div>
    </div>
  );
}
