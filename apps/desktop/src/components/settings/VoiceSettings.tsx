import { useCallback, useState } from 'react';
import { useVoiceStore, DEFAULT_POLISH_PROMPT, SPOKEN_LANGUAGES } from '@/store/voiceStore';
import { isTauri } from '@/utils/platform';
import { invoke } from '@tauri-apps/api/core';
import { Toggle } from '@/components/settings/primitives';
import { useHotkeyRecording } from '@/components/settings/useHotkeyRecording';

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

type PermState = 'idle' | 'checking' | 'granted' | 'denied';

/// One macOS permission row with a state-machine button (idle → checking →
/// granted/denied). Reused for accessibility + mic + speech so the three
/// affordances stay visually + behaviorally identical.
/// ponytail: extracted at the third consumer — the inline JSX was triplicated.
function PermissionRow({ title, desc, idleLabel, state, onClick }: {
  title: string; desc: string; idleLabel: string; state: PermState; onClick: () => void;
}) {
  return (
    <Row title={title} desc={desc}>
      <button
        className="text-[length:calc(var(--ui-font-size)-2.5px)] px-2.5 py-1 rounded-md border border-brd2 bg-surf2 text-t1 hover:bg-hov cursor-pointer disabled:opacity-50 disabled:cursor-default"
        disabled={state === 'checking'}
        onClick={onClick}
      >
        {state === 'checking'
          ? '检查中…'
          : state === 'granted'
            ? '已授权 ✓'
            : state === 'denied'
              ? '仍未授权,点击重试'
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

      {onMac && (
        <>
          <PermissionRow
            title="辅助功能权限"
            desc="跨应用插入文本需要辅助功能权限。点击按钮触发系统授权弹框;授权后需重启应用生效(TCC 缓存进程启动时的判定)。"
            idleLabel="授权辅助功能"
            state={axState}
            onClick={() => void requestPerm('voice_request_accessibility', setAxState)}
          />
          <PermissionRow
            title="麦克风权限"
            desc="录音需要麦克风权限。点击按钮触发系统授权弹框;若曾拒绝,需在 系统设置 → 隐私与安全性 → 麦克风 中允许 Quill 后再点重试。"
            idleLabel="授权麦克风"
            state={micState}
            onClick={() => void requestPerm('voice_request_microphone', setMicState)}
          />
          <PermissionRow
            title="语音识别权限"
            desc="Apple Speech 转写需要语音识别权限。点击按钮触发系统授权弹框;若曾拒绝,需在 系统设置 → 隐私与安全性 → 语音识别 中允许 Quill 后再点重试。"
            idleLabel="授权语音识别"
            state={speechState}
            onClick={() => void requestPerm('voice_request_speech', setSpeechState)}
          />
        </>
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
