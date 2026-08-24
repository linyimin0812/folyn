# ai-voice-input

## Goal

Add a voice input feature to the AI chat panel (mic button in `ChatInput` leadingSlot) that transcribes speech via Apple's native `SFSpeechRecognizer` (macOS only). Add a top-level `voice` settings tab for the polish prompt and behavior toggles. Reuse the existing AI config (`chatProvider/chatModel/chatApiKey/chatBaseUrl` + existing rig/chat call path) for the auto-polish LLM pass. Output goes to the cursor-focused input field (including other applications' fields, via CoreGraphics CGEvent Cmd+V). Raw audio source file can optionally be saved (default dir `.voice_input`). Trigger via mic button AND a configurable global hotkey.

## Requirements

- **Mic button** in `ChatInput.tsx` leadingSlot (next to attach + mode buttons). Toggle: click to start, click to stop. Visual indicator while recording.
- **Global hotkey** (configurable in settings; default unset). Push-to-talk semantics — when held, recording; on release, transcribe → polish → insert into focused input.
- **Transcription**: macOS `SFSpeechRecognizer` via pure-Rust `objc2` FFI (port of openless `apple_speech_provider.rs`). On-device recognition when supported. Multi-utterance accumulation (don't lose text on pauses).
- **Auto-polish** (default ON, toggleable): after transcription, run the transcript through the LLM using the user's polish prompt + existing AI config. Polish is a frontend orchestration — calls `runRigChat`-equivalent path with a one-shot LLM completion. When OFF, skip polish and use raw transcript.
- **Insert into focused input** (cross-app): via CGEvent-posted Cmd+V (port of openless `insertion.rs` macOS path). Clipboard is written first as fallback so a failed paste still leaves text in clipboard. Requires Accessibility permission — prompt on first use.
- **Source audio save**: when "保存语音源文件" toggle is ON, save the 16kHz mono Int16 PCM as WAV to `<vault>/.voice_input/<timestamp>.wav`. Default OFF. Directory configurable in settings.
- **Voice settings page**: new top-level `voice` tab in `SettingsPage` (after `ai`). Fields:
  - Polish prompt (multi-line textarea, with sensible default)
  - 自动润色 toggle (default ON)
  - 保存语音源文件 toggle (default OFF)
  - 源文件目录 (default `.voice_input`, relative to vault root)
  - 全局热键 (configurable, default empty)
- **Windows**: mic button + hotkey disabled with tooltip "Windows 暂不支持语音输入".

## Acceptance Criteria

- [ ] On macOS, clicking mic button records mic → transcribes via Apple Speech → (if auto-polish ON) polishes via existing AI config → inserts at cursor in focused input (cross-app).
- [ ] Global hotkey (when configured) triggers the same flow without Folyn having focus.
- [ ] "保存语音源文件" ON → WAV saved to `.voice_input/<timestamp>.wav`.
- [ ] Voice settings page renders + persists all fields via `registerPersistSlice`.
- [ ] Auto-polish OFF → raw transcript inserted directly.
- [ ] First-run permission flow (mic via cpal, speech via SFSpeechRecognizer.requestAuthorization, accessibility for CGEvent) handled with user-facing errors.
- [ ] Windows: mic button disabled with tooltip; no macOS-only code compiled on Windows.
- [ ] Mic button shows recording state (color/pulse).
- [ ] Unit tests for: voice settings store hydration/persistence; SegmentAccumulator multi-utterance logic (ported from openless); WAV encoder.

## Definition of Done

- Tests added for voiceStore + SegmentAccumulator + wav encoder (where mockable, no mic/Speech FFI).
- `cargo check` + `cargo test` on macOS green; `pnpm typecheck` + `pnpm test` green.
- `tauri build` succeeds on macOS.
- Manual smoke: record → polish → insert into TextEdit / browser textarea.
- Permission prompts documented (mic, speech recognition, accessibility).

## Technical Approach

**Backend (Rust, `apps/desktop/src-tauri/src/`)**:
- New `voice_macos.rs` module (cfg-gated `#[cfg(target_os = "macos")]`), port minimal subset from openless:
  - `AppleSpeechAsr` + `transcribe_pcm_blocking` + `SegmentAccumulator` (battle-tested, ~600 lines net of comments).
  - `Recorder` (cpal-based mic capture → 16kHz mono Int16 PCM).
  - `TextInserter::insert` (CGEvent Cmd+V + clipboard write + restore).
  - `encode_wav_16k_mono` helper.
- New Tauri commands (registered in `lib.rs`):
  - `voice_start` — begin recording (spawns recorder thread, buffers PCM).
  - `voice_stop` → returns `{ transcript, audio_path? }` (transcribes + saves source if enabled + returns final text).
  - `voice_cancel` — abort recording + transcribe.
  - `voice_insert_text(text)` — clipboard + CGEvent Cmd+V (for cross-app insert).
- Cargo.toml: add `cpal`, `block2`, `objc2` (verify versions match openless / existing `pet_panel_macos` usage).

**Frontend (TS, `apps/desktop/src/`)**:
- `store/voiceStore.ts` — zustand store with `registerPersistSlice` (mirrors `aiConfigStore` pattern). Fields: `polishPrompt`, `autoPolish`, `saveSource`, `sourceDir`, `globalHotkey`.
- `components/settings/VoiceSettings.tsx` — new settings panel.
- Wire `voice` tab into `SettingsPage.tsx` tab list (line ~147).
- `components/ai/VoiceInputButton.tsx` — mic button in `ChatInput` leadingSlot, manages start/stop state, invokes Tauri commands, runs polish via existing `runRigChat` path, calls `voice_insert_text`.
- Global hotkey registration via Tauri `globalShortcut` plugin (or `tauri-plugin-global-shortcut`).

**Polish flow** (frontend orchestration, NOT in Rust):
1. `voice_stop` returns `transcript`.
2. If `autoPolish` ON and `polishPrompt` non-empty: call `runRigChat({ prompt: transcript, systemPrompt: polishPrompt, ...aiConfig })` → returns polished text.
3. Call `voice_insert_text(polished_or_raw)` → Tauri command writes to clipboard + posts Cmd+V to focused app via CGEvent.

## Decision (ADR-lite)

**Context**: User pointed at openless project (`/Users/yiminlin/project/openless/openless-all/app/src-tauri/src`) as the reference; it has a proven pure-Rust objc2 FFI to SFSpeechRecognizer + cpal recorder + CGEvent inserter, matching Folyn's existing `objc2`/`cocoa` pattern (`pet_panel_macos.rs`).
**Decision**: Port minimal subset of openless modules into Folyn's `src-tauri/src/voice_macos.rs`. Pure Rust objc2, no Swift helper. Polish stays in frontend (reuses `runRigChat` + `aiConfigStore`); Rust side is transcribe + insert primitives only.
**Consequences**: + zero new deps beyond `cpal`/`block2`/`objc2` (verify); + matches repo conventions; + polish is decoupled from ASR engine. - 500+ lines objc FFI to maintain (battle-tested in openless, acceptable).

## Out of Scope

- Windows implementation (hide/disable only).
- Non-Apple speech engines (Whisper etc.) — user explicitly chose Apple Speech.
- Real-time streaming polish (polish runs after full transcription).
- Speaker diarization / multi-voice.
- Real-time streaming partial transcript display (batch-mode only, like openless v1).
- Voice activity detection / auto-stop on silence (manual stop only this round).

## Implementation Plan (small PRs)

- **PR1 — Backend skeleton + settings store**: Add `voice_macos.rs` (cfg-gated, stub Tauri commands returning errors), `voiceStore.ts`, `VoiceSettings.tsx`, wire `voice` tab. Verify `cargo check` + `pnpm typecheck` green on macOS + Windows.
- **PR2 — Apple Speech FFI + recorder**: Port `apple_speech_provider.rs` + `recorder.rs` + `asr/wav.rs` minimal subset. Implement `voice_start`/`voice_stop`/`voice_cancel`. Unit tests for SegmentAccumulator + wav encoder.
- **PR3 — Cross-app insert + polish + UI**: Port `insertion.rs` macOS path. Implement `voice_insert_text` command. Add `VoiceInputButton.tsx` in `ChatInput` leadingSlot. Wire polish via `runRigChat`. Source file save to `.voice_input/`.
- **PR4 — Global hotkey + permission UX**: Add `tauri-plugin-global-shortcut`, wire configurable hotkey from settings. First-run permission flow (mic, speech, accessibility) with user-facing errors. Manual smoke test.

## Technical Notes

- `objc2` + `cocoa` already in `Cargo.toml`; `pet_panel_macos.rs` establishes the FFI pattern. Add `cpal` (mic capture) + `block2` (block-based callback for SFSpeechRecognizer.requestAuthorization).
- `tauri.conf.json` has `macOSPrivateApi: true` already (for pet panel) — no additional private API opt-in needed.
- Clipboard plugin present; cross-app paste uses CoreGraphics CGEvent (system framework, no extra dep).
- `.voice_input` follows `.folyn-tmp` convention (per-vault hidden dir).
- SettingsPage tab list at lines 136–149; new `voice` tab inserted after `ai` (line 145).
- `registerPersistSlice` pattern at `store/settingsPersistence.ts`; follow `aiConfigStore` template.

## Research References

- `/Users/yiminlin/project/openless/openless-all/app/src-tauri/src/asr/local/apple_speech_provider.rs` — SFSpeechRecognizer FFI (1399 lines, batch-mode, multi-utterance accumulation).
- `…/asr/wav.rs` — `encode_wav_16k_mono` (61 lines).
- `…/recorder.rs` — cpal mic capture → 16kHz mono Int16 PCM (932 lines).
- `…/insertion.rs` — cross-app CGEvent Cmd+V inserter (802 lines).
- `…/polish.rs` — polish prompt template + LLM call shape (3171 lines, only reference the prompt default; LLM call goes through Folyn's `runRigChat`).
