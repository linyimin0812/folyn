import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { useVoiceStore } from '@/store/voiceStore';
import { useAiConfigStore } from '@/store/aiConfigStore';
import { useVaultStore } from '@/store/vaultStore';
import { runRigChat } from '@/services/rigChat';
import { isTauri } from '@/utils/platform';
import { resolveBasePath } from '@/utils/pathResolver';

// ponytail: a zustand store IS a hook (`useVoiceInput((s) => s.phase)`), so
// one file satisfies the project's "extract a reusable hook" requirement
// without a separate subscribe layer. Both consumers — VoiceInputButton and
// the App.tsx global-hotkey listener — read phase via the hook selector and
// drive the flow via `useVoiceInput.getState().start()/stop()` (out-of-React
// imperative access). The store is runtime-only (not persisted) — voice
// SETTINGS live in voiceStore; this owns the active recording state machine.

export type VoicePhase =
  | 'idle'
  | 'recording'
  | 'transcribing'
  | 'polishing'
  | 'inserting'
  | 'error';

/** Which entry point kicked off the current recording. Drives UI: the
 *  SiriGL waveform overlay only shows for the global-hotkey path (bottom-
 *  center of the main window); the mic-button path uses the button body
 *  itself (red bg + stop square) as the sole indicator. */
export type VoiceTrigger = 'hotkey' | 'button' | null;

export interface VoiceInputState {
  phase: VoicePhase;
  error: string | null;
  trigger: VoiceTrigger;
  /** Start recording. `trigger` labels the entry point so the overlay can
   *  gate on the hotkey path. No-op (returns) if not on macOS or already
   *  recording. */
  start: (trigger?: 'hotkey' | 'button') => Promise<void>;
  /** Stop → transcribe → (optional) polish → insert into focused input.
   *  Silently returns to idle on an empty transcript (user stayed silent). */
  stop: () => Promise<void>;
  /** Dismiss the error state and return to idle immediately. */
  clearError: () => void;
}

/** macOS-only check mirroring the one in VoiceInputButton. The hotkey path
 *  on a non-macOS build would call `start()` → `invoke('voice_start')` →
 *  macOS-only error; we short-circuit here so the button stays calm. */
function onMac(): boolean {
  return isTauri() && typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);
}

// Internal: a 3s timer that auto-clears the error dot. Module-level so the
// store action can clear/extend it across calls without exposing it.
let errorTimer: ReturnType<typeof setTimeout> | null = null;

/** Broadcast the current phase + trigger to the voice-orb window. The
 *  voice-orb is a SEPARATE Tauri window (separate JS realm) — its copy of
 *  `useVoiceInput` starts at `idle` and never receives the main window's
 *  state updates. Tauri's `emit` broadcasts to every window, so the orb's
 *  `voice://orb-phase` listener (VoiceOrbApp.tsx) gets the source of truth
 *  for mode/resolved/merging. Swallows emit errors so a missing orb window
 *  never breaks the main flow. */
function emitOrbPhase(phase: VoicePhase, trigger: VoiceTrigger): void {
  if (!isTauri()) return;
  void import('@tauri-apps/api/event').then(({ emit }) =>
    emit('voice://orb-phase', { phase, trigger }).catch(() => {}),
  );
}

function flashError(set: (partial: Partial<VoiceInputState>) => void, msg: string): void {
  console.error('[voice]', msg);
  if (errorTimer) clearTimeout(errorTimer);
  set({ phase: 'error', error: msg });
  emitOrbPhase('error', useVoiceInput.getState().trigger);
  errorTimer = setTimeout(() => {
    errorTimer = null;
    // Only auto-reset to idle if we're STILL in the error phase. Bug #1's
    // saveError path calls flashError then immediately advances phase to
    // 'polishing'/'inserting' (the insert must proceed). A bare
    // `set({ phase: 'idle' })` here would regress that. `get` is captured by
    // closure below — see the `useVoiceInput` factory.
    if (useVoiceInput.getState().phase === 'error') {
      set({ phase: 'idle', error: null });
      emitOrbPhase('idle', null);
    } else {
      // Phase already advanced (saveError non-fatal path) — just clear the
      // lingering error text so it doesn't show up next time.
      set({ error: null });
    }
  }, 3000);
}

export const useVoiceInput = create<VoiceInputState>((set, get) => ({
  phase: 'idle',
  error: null,
  trigger: null,

  start: async (trigger: 'hotkey' | 'button' = 'button') => {
    if (get().phase !== 'idle') return;
    if (!onMac()) return;
    set({ phase: 'recording', error: null, trigger });
    emitOrbPhase('recording', trigger);
    // Bug #2 fix: pass the user's spoken-language locale so Apple Speech
    // routes recognition to the right engine. Empty string = None (system
    // default) — the dropdown always has a value, so this is defensive.
    const spokenLocale = useVoiceStore.getState().spokenLanguage ?? '';
    try {
      await invoke('voice_start', { spokenLocale });
    } catch (err) {
      flashError(set, typeof err === 'string' ? err : String(err));
    }
  },

  stop: async () => {
    // Only stop if we're currently recording — a stray release event from
    // the hotkey while idle/transcribing is ignored (matches the button
    // guard).
    if (get().phase !== 'recording') return;

    set({ phase: 'transcribing', error: null });
    emitOrbPhase('transcribing', get().trigger);
    const { saveSource, sourceDir, autoPolish, polishPrompt } = useVoiceStore.getState();
    const rawVaultPath = useVaultStore.getState().currentVault?.basePath ?? '';

    // Bug #1 fix: `currentVault.basePath` 可能是 `~/quill/default_vault`（默认
    // 创建路径就是这样，见 vaultStore.ts:155）。`~` 不展开会让 Rust 的
    // `Path::new("~/quill/default_vault").join(".voice_input")` 把 `~` 当成
    // CWD 下的字面目录，WAV 写到 `<process cwd>/~/quill/default_vault/...` 而
    // 不是 `/Users/<user>/quill/default_vault/.voice_input/<ts>.wav`。复用
    // `resolveBasePath`（vaultStore 已在打开 vault 前调用同一个 helper）保证
    // 一致行为。
    const vaultPath = isTauri() ? await resolveBasePath(rawVaultPath) : rawVaultPath;

    let transcript: string;
    let saveError: string | null = null;
    try {
      const result = await invoke<{
        transcript: string;
        audioPath: string | null;
        saveError: string | null;
      }>('voice_stop', { saveSource, sourceDir, vaultPath });
      transcript = (result?.transcript ?? '').trim();
      saveError = result?.saveError ?? null;
    } catch (err) {
      flashError(set, typeof err === 'string' ? err : String(err));
      return;
    }

    // Bug #1 fix: surface source-save failures as a brief inline error so the
    // user knows the WAV is missing (instead of wondering). The transcript
    // flow still proceeds — save failure is non-fatal, so we call flashError
    // but DON'T return; the subsequent `set({ phase: 'polishing' })` overrides
    // the phase, and the error dot surfaces in the title text. The flashError
    // 3s timer only clears the error text — polish/insert phase transitions
    // continue normally.
    if (saveError) {
      console.warn('[voice] source audio save error:', saveError);
      flashError(set, saveError);
    }

    if (!transcript) {
      // Bug #2 fix: silent return was the worst UX — the user couldn't tell
      // if anything ran. Surface a brief "未识别到语音内容" error instead of
      // disappearing to idle.
      flashError(set, '未识别到语音内容,请重试');
      return;
    }

    let finalText = transcript;
    const shouldPolish =
      autoPolish &&
      polishPrompt.trim().length > 0 &&
      useAiConfigStore.getState().chatApiKey.trim().length > 0;
    if (shouldPolish) {
      set({ phase: 'polishing' });
      emitOrbPhase('polishing', get().trigger);
      // ponytail: runRigChat has no systemPrompt param (chat_stream hardcodes
      // a PREAMBLE). Prepend the polish prompt + transcript so the LLM gets
      // the instruction in-band; the polish prompt already ends with
      // "原始文本:" making the concatenation read naturally. A per-call
      // unique sessionId keeps each polish a fresh one-turn conversation
      // (history would otherwise leak prior polish context into the next).
      const sessionId = `voice-polish-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const { chatProvider, chatModel, chatApiKey, chatBaseUrl } = useAiConfigStore.getState();
      try {
        finalText = await new Promise<string>((resolve, reject) => {
          let acc = '';
          void runRigChat({
            sessionId,
            prompt: polishPrompt + transcript,
            provider: chatProvider,
            model: chatModel,
            apiKey: chatApiKey,
            baseUrl: chatBaseUrl || undefined,
            onEvent: (e) => {
              if (e.type === 'text' && e.content) acc += e.content;
              else if (e.type === 'error') reject(new Error(e.content ?? 'polish error'));
              else if (e.type === 'done') resolve(acc.trim() || transcript);
            },
          }).catch(reject);
        });
      } catch (err) {
        // Polish failed — fall back to raw transcript so the user still
        // gets their voice text. The insert below still runs; the error is
        // logged but NOT surfaced (the text lands first).
        console.error('[voice] polish failed, using raw transcript:', err);
        finalText = transcript;
      }
    }

    set({ phase: 'inserting' });
    emitOrbPhase('inserting', get().trigger);
    try {
      await invoke('voice_insert_text', { text: finalText });
    } catch (err) {
      flashError(set, typeof err === 'string' ? err : String(err));
      return;
    }
    set({ phase: 'idle', trigger: null });
    emitOrbPhase('idle', null);
  },

  clearError: () => {
    if (errorTimer) {
      clearTimeout(errorTimer);
      errorTimer = null;
    }
    set({ phase: 'idle', error: null, trigger: null });
    emitOrbPhase('idle', null);
  },
}));
