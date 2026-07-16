import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { useVoiceStore } from '@/store/voiceStore';
import { useAiConfigStore } from '@/store/aiConfigStore';
import { useVaultStore } from '@/store/vaultStore';
import { runRigChat } from '@/services/rigChat';
import { isTauri } from '@/utils/platform';

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

export interface VoiceInputState {
  phase: VoicePhase;
  error: string | null;
  /** Start recording. No-op (returns) if not on macOS or already recording. */
  start: () => Promise<void>;
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

function flashError(set: (partial: Partial<VoiceInputState>) => void, msg: string): void {
  console.error('[voice]', msg);
  if (errorTimer) clearTimeout(errorTimer);
  set({ phase: 'error', error: msg });
  errorTimer = setTimeout(() => {
    set({ phase: 'idle', error: null });
    errorTimer = null;
  }, 3000);
}

export const useVoiceInput = create<VoiceInputState>((set, get) => ({
  phase: 'idle',
  error: null,

  start: async () => {
    if (get().phase !== 'idle') return;
    if (!onMac()) return;
    set({ phase: 'recording', error: null });
    try {
      await invoke('voice_start');
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
    const { saveSource, sourceDir, autoPolish, polishPrompt } = useVoiceStore.getState();
    const vaultPath = useVaultStore.getState().currentVault?.basePath ?? '';

    let transcript: string;
    try {
      const result = await invoke<{ transcript: string; audioPath: string | null }>(
        'voice_stop',
        { saveSource, sourceDir, vaultPath },
      );
      transcript = (result?.transcript ?? '').trim();
    } catch (err) {
      flashError(set, typeof err === 'string' ? err : String(err));
      return;
    }

    if (!transcript) {
      // Silent recording — return to idle without surfacing an error.
      set({ phase: 'idle' });
      return;
    }

    let finalText = transcript;
    const shouldPolish =
      autoPolish &&
      polishPrompt.trim().length > 0 &&
      useAiConfigStore.getState().chatApiKey.trim().length > 0;
    if (shouldPolish) {
      set({ phase: 'polishing' });
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
    try {
      await invoke('voice_insert_text', { text: finalText });
    } catch (err) {
      flashError(set, typeof err === 'string' ? err : String(err));
      return;
    }
    set({ phase: 'idle' });
  },

  clearError: () => {
    if (errorTimer) {
      clearTimeout(errorTimer);
      errorTimer = null;
    }
    set({ phase: 'idle', error: null });
  },
}));
