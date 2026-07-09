# Research: Input-Box & Streaming-Event Layer of Both Chat UIs

- **Query**: Research the input-box & streaming-event layer of PetChat + AiPanel to inform extracting a shared `ChatInputBox` (slot-based) and a unified streaming callback contract.
- **Scope**: internal
- **Date**: 2026-07-09

## Findings

### Files Found

| File Path | Description |
|---|---|
| `apps/desktop/src/components/pet/PetChat.tsx` | Pet-side: input row + handleSend + stop + clear + unmount cleanup + unconfigured CTA |
| `apps/desktop/src/services/petChatService.ts` | Pet-side: sendPetChatMessage/stopPetChat/resetPetChatAdapter; bare:true; cwd=appData/pet-chat-tmp; adapter caching |
| `apps/desktop/src/store/petChatStore.ts` | Pet-side store: addMessage/appendToLastMessage/clear/setStreaming (persisted `pet-chat:messages`) |
| `apps/desktop/src/components/ai/AiPanel.tsx` | Ai-side: handleSend (attachment Read instructions, @file resolution, blob save, adapter start, watcher pause/resume) |
| `apps/desktop/src/components/ai/ChatInput.tsx` | Ai-side input: attachments, @-mention popup, input-mode dropdown, textarea, file picker, send/stop |
| `apps/desktop/src/components/ai/inputModes.ts` | Declarative input-mode registry (agent/ask); `resolveSendOptions` merges onto CliSendOptions |
| `apps/desktop/src/components/ai/adapterManager.ts` | `sessionAdapters` Map + `getAdapterForSession(sessionId)` per-session adapter caching |
| `apps/desktop/src/store/aiStore.ts` | Ai-side store: addMessage/appendToLastMessage/appendThinking/addToolCall/completeToolCall/addFileChange/setSessionStreaming/setCliSessionId |
| `packages/cli-adapter/src/types.ts` | `CliStreamEvent` union + `CliAdapter` API + `CliMessage`/`CliSendOptions` |
| `packages/cli-adapter/src/baseAdapter.ts` | `BaseCliAdapter` — onEvent/offEvent/emit handler list |
| `apps/desktop/src/components/ai/ChatMessages.tsx` | Shared list (consumer of `CliMessage[]` + `isStreaming`) — confirms list needs NO raw events |

---

### 1. Input Box

#### PetChat (`PetChat.tsx:209-251`)

- **Element/classes**: BEM (`pet-chat-input-row`, `pet-chat-input`, `pet-chat-send`, `pet-chat-stop`, `pet-chat-clear`). NOT Tailwind.
- **Textarea**: `rows={1}`, `placeholder="输入消息，Enter 发送"`, `disabled={streaming}`, `aria-label="Pet chat input"`. Value = local `input` state.
- **Enter behavior** (`handleKeyDown` L138-146): `Enter && !shiftKey` → `preventDefault()` + `handleSend()`. No Shift+Enter branch (default browser newline falls through).
- **Send ↔ Stop toggle** (L220-245): `streaming ? <stop btn> : <send btn>`. Send `disabled={!input.trim()}`. Both render an SVG icon inside `.pet-chat-action-icon`.
- **Clear button** (L247-251): rendered only when `messages.length > 0`, `disabled={streaming}`, calls `clear()`.
- **No attachments row, no @-mention popup, no input-mode dropdown, no file picker.** (PetChat is vault-free, R6.)
- **Disabled-on-empty**: send button `disabled={!input.trim()}`.

#### AiPanel / ChatInput (`ChatInput.tsx:244-356`)

- **Element/classes**: Tailwind utilities (`flex flex-col py-2.5 px-3 border-t border-brd`, inner box `border border-brd rounded-lg bg-inp`).
- **Textarea** (L276-287): `rows={2}`, `placeholder="输入指令，@ 引用文件..."`, `disabled={isStreaming}`, `autoCapitalize="off"`, `ref=textareaRef`.
- **Enter behavior** (`handleKeyDown` L164-191): if `mentionMenu.visible` → ArrowDown/Up navigate, Enter/Tab select mention, Escape closes. Otherwise `Enter && !shiftKey` → `handleSendClick()`. Shift+Enter → newline (default).
- **Attachments row** (L246-260): `attachments` state of `PendingAttachment[]` (`{id,name,type:'image'|'file',path?,blob?,previewUrl?}`). Rendered as chips with `FileIcon`/thumbnail + `×` remove. Populated by: paste image (`handlePaste` L193-213), file picker (`handleFileInputChange` L219-234), @-mention insert (L126-153), pending files from `aiStore.pendingFileAttachments` (L58-73).
- **@-mention popup** (L262-275): `mentionMenu = {visible, filter, anchorPos}`. Trigger logic in `handleInputChange` (L109-124): find last `@` before cursor where preceding char is whitespace/start; filter has no space/newline. Popup positioned `absolute bottom-full` (renders ABOVE textarea, inside the bordered box). `filteredMentionFiles` = `flattenFileTree(fileTree)` filtered by `mentionMenu.filter`, active file prioritized first, capped at 20. `insertMention` (L126-153): splices out `@filter` text, sets input, AND pushes the file as an attachment (NOT inline `@path` text in textarea). Selection restored to `anchorPos`.
- **Input-mode dropdown** (L294-325): `modeMenuOpen` state, `inputModes = listInputModes()` (agent/ask). Button shows `currentModeDef.label`. Dropdown `absolute bottom-full left-0`. `onMouseDown preventDefault` + `setInputMode(m.id)`. `useAiStore.inputMode` is global (not per-session). Only rendered if `inputModes.length > 1`.
- **File picker** (L289-293, L347-354): hidden `<input type="file" multiple accept="image/*,.txt,.md,...">`. `handleFileSelect` clicks it; `handleFileInputChange` adds each file as a `PendingAttachment`.
- **Send ↔ Stop toggle** (L327-344): `isStreaming ? stop(red) : send(acc)`. Send `disabled={!input.trim() && attachments.length === 0}` (note: OR-of-both-empty, so attachments alone can send).
- **No "clear" button** on AiPanel side.
- **Pending prompt injection** (L76-89): `aiStore.pendingPrompt` prefills the textarea + focuses end (study workbench AI actions use this).

---

### 2. Send Flow

#### PetChat (`PetChat.tsx:99-121`, `petChatService.ts:104-136`)

- **Prompt**: raw trimmed `input`. No attachment instructions, no @file resolution.
- **Store mutations before send**: `addMessage('user', prompt)` + `addMessage('assistant','')` + `setStreaming(true)`. `setInput('')`.
- **Adapter start**: `adapter.start({ cliPath: settings.cliPath, workingDir })` where `workingDir = resolveWorkingDir()` = `<appData>/pet-chat-tmp` (mkdir'd; fallback chain to appData, then '').
- **Send options**: `adapter.send(prompt, { bare: true })`. No `resumeSessionId` (fresh exchange each send). No vault system prompt.
- **Adapter lifecycle**: one cached adapter per mount, keyed by `settings.cliAdapter` id; `getPetChatAdapter()` reuses `cachedAdapter` if id matches, else creates fresh via `CliAdapterRegistry.getInstance().create(id)`.

#### AiPanel (`AiPanel.tsx:152-356`)

- **Prompt building** (L262-291):
  - Start: `prompt = userText`.
  - Blob attachments saved first to `${workingDir}/.quill-tmp/img-<ts>-<rand>.<ext>` via base64-decode through `claude-cli` shell command (L224-260). Path-attachments pass through unchanged.
  - If image attachments exist: prepend `请先使用 Read 工具读取以下图片文件:\n<paths>`.
  - If file attachments exist: prepend `请先使用 Read 工具读取以下文件:\n<paths>`.
  - Then @file mentions: regex `/@([\w\-./一-鿿]+)/g` matched against `allFiles` (flattenFileTree of vault). If matches: prepend `请先使用 Read 工具读取以下文件:\n<paths>` then `\n\n用户消息: <prompt>`.
- **Blob save location**: `<vault>/.quill-tmp/` (NOT appData — vault-grounded). Uses `claude-cli` shell `mkdir -p` + `printf base64 | base64 -D`.
- **workingDir** (L214-221): `vault?.basePath ?? ''`, `~` expanded via `homeDir()`.
- **Adapter start** (L299, L343-348): `getAdapterForSession(sessionId)` — per-session cached adapter in `sessionAdapters` Map. `adapter.start({ cliPath, workingDir })`.
- **Send options** (L346-348): `resolveSendOptions(inputMode, { resumeSessionId })`. `resumeSessionId = targetSession.cliSessionId ?? undefined` (resume across turns). `resolveSendOptions` merges `permissionMode`/`bare`/`systemPrompt` from the registered mode def (agent=`bypassPermissions`, ask=`plan`).
- **Pre-send** (L340-341): `flushAutoSaves()` then `pauseWatcher()`.
- **Store mutations before send**: `addMessage('user', text, sessionId, previewAttachments)` + `addMessage('assistant','', sessionId)` + `setSessionStreaming(sessionId, true)`.

---

### 3. Streaming Event Handling

`CliStreamEvent` union (`types.ts:34-53`): `text | thinking | tool_start | tool_end | file_change | session_id | error | done`. Fields: `content?`, `toolName?`, `toolId?`, `toolInput?`, `toolOutput?`, `fileChange?`, `sessionId?`.

#### PetChat service mapping (`petChatService.ts:116-126`)

Pet service only handles 3 variants — it IGNORES thinking/tool_start/tool_end/file_change/session_id.

| CliStreamEvent | Pet action |
|---|---|
| `text` (content) | `handlers.onToken(event.content)` → store `appendToLastMessage(text)` |
| `error` | `adapter.offEvent(handler)` + `handlers.onError(content||'LLM error')` → `appendToLastMessage('\n\n[错误] '+msg)` + `setStreaming(false)` |
| `done` | `adapter.offEvent(handler)` + `handlers.onDone()` → `setStreaming(false)` |
| thinking / tool_* / file_change / session_id | **not handled** (silently dropped) |

#### AiPanel mapping (`AiPanel.tsx:305-337`)

Full event coverage:

| CliStreamEvent | Ai action |
|---|---|
| `text` (content) | `appendToLastMessage(event.content, sid)` |
| `thinking` (content) | `appendThinking(event.content, sid)` |
| `tool_start` (toolId+toolName) | `addToolCall(toolId, toolName, toolInput, sid)` |
| `tool_end` (toolId) | `completeToolCall(toolId, toolOutput, sid)` |
| `file_change` (fileChange) | `addFileChange(fileChange, sid)` (also suppresses watcher + enters diff review if pending) |
| `session_id` (sessionId) | `setCliSessionId(sessionId, sid)` |
| `error` (content) | `appendToLastMessage('\n\n[错误] '+content, sid)` |
| `done` | `setSessionStreaming(sid,false)` + `adapter.offEvent` + `vaultStore.refreshFileTree()` + `editorStore.checkDiskChanges().finally(resumeWatcher)` |

Key asymmetry: Pet only consumes `text`+`error`+`done`; Ai consumes all 8. Pet's assistant message is a flat string; Ai's `CliMessage` carries `thinking`, `toolCalls`, `attachments` (rich schema in `types.ts:8-16`).

---

### 4. Stop / Unmount Lifecycle

#### PetChat

- **Stop** (`handleStop` L123-126): `stopPetChat()` (calls `cachedAdapter.stop()`) + `setStreaming(false)`.
- **Unmount** (L86-97): if `streaming` → `stopPetChat().finally(() => { setStreaming(false); resetPetChatAdapter(); })`; else `resetPetChatAdapter()`. `resetPetChatAdapter` nulls `cachedAdapter` + `cachedAdapterId` so next mount starts a fresh process. NOTE: this cleanup effect deps on `[streaming, setStreaming]` — so it re-runs whenever streaming flips; the cleanup-only-return pattern means each re-run of the effect first runs the PREVIOUS cleanup. (Potential subtlety worth noting for a shared component: the unmount cleanup is not strictly unmount-only.)

#### AiPanel

- **Stop** (`handleStop` L358-366): `sessionAdapters.get(activeSessionId)?.stop()` + `resumeWatcher()` + `setSessionStreaming(activeSessionId,false)`.
- **No unmount-stop**: AiPanel unmount (panel hide) does NOT stop the adapter — the per-session adapter in `sessionAdapters` Map keeps running; `isStreaming` stays true; the streaming indicator persists in the session list. Adapter is only stopped on explicit Stop or `deleteSession` (which `sessionAdapters.delete(id)`s).
- **Watcher**: `pauseWatcher()` before `adapter.start`, `resumeWatcher()` in `done` handler / catch / handleStop. So file-watcher is paused ONLY around the active stream, not around mount.

---

### 5. "Unconfigured AI" CTA

- **PetChat** (`isPetChatConfigured` L61-64 + L159-169): `Boolean(settings.cliAdapter && settings.cliPath)`. If false, renders `.pet-chat-empty` with title `未配置 AI`, desc, and `.pet-chat-cta` button `打开 AI 设置` → `handleOpenSettings` (L148-157) sets `currentPage='settings'`, `settingsTab='ai'`, emits `pet://menu-action` with `show-main` to focus main window.
- **AiPanel**: NO explicit unconfigured CTA. `settings.cliPath`/`cliAdapter` default to `'claude'`/`'claude'`, so AiPanel always attempts to start the adapter; if the binary is missing, the `error` event surfaces inline as `[错误] …` in the assistant message. There is no "open settings" button — the user must open settings elsewhere.

---

## Synthesis

### PROPOSED `ChatInputBox` Props Contract (slot-based)

```ts
interface ChatInputBoxProps {
  // --- base (both sides) ---
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  streaming: boolean;
  onStop?: () => void;        // pet + ai both pass; renders stop btn when streaming
  onClear?: () => void;       // pet passes clear(); ai omits → no clear btn
  disabled?: boolean;         // ai: !input.trim() && attachments.length===0; pet: !input.trim()
  placeholder?: string;       // pet: "输入消息，Enter 发送"; ai: "输入指令，@ 引用文件..."
  textareaRows?: number;      // pet: 1; ai: 2
  inputAriaLabel?: string;    // pet: "Pet chat input"

  // --- keyboard override hook (for @-mention nav) ---
  onBeforeKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => boolean;
  //  returns true if consumed (mention nav), so base Enter-handler is skipped.
  //  AiPanel passes its mention-navigation handler; PetChat passes nothing.

  // --- slots (AiPanel fills; PetChat leaves undefined) ---
  leadingSlot?: React.ReactNode;   // file-picker button + input-mode dropdown (ai toolbar row)
  attachmentsRow?: React.ReactNode; // attachment chips (ai only)
  overlayLayer?: React.ReactNode;   // @-mention popup + mode-menu dropdown (absolutely-positioned, rendered inside the bordered box)
  trailingSlot?: React.ReactNode;   // reserved; send/stop are owned by base (toggle)
}
```

**Slot injection**:
- AiPanel injects: `attachmentsRow` = attachment chips; `leadingSlot` = file-picker button + input-mode dropdown; `overlayLayer` = @-mention popup + mode-menu dropdown (both `absolute bottom-full`); `onBeforeKeyDown` = mention-nav handler.
- PetChat injects: nothing — passes only base props + `onClear`. Send/stop toggle is owned by base.
- The @-mention popup and input-mode dropdown live in the `overlayLayer` slot (NOT inside base), because they depend on vault `fileTree` + `aiStore.inputMode` — logic that must NOT be imported at the top level of `ChatInputBox` (Tauri-window isolation: the pet-panel window has no vault/editor stores).

**Styling note**: the two sides currently diverge — PetChat uses BEM (`.pet-chat-input-row`), AiPanel uses Tailwind. The shared component should standardize on Tailwind (AiPanel's style), and PetChat's BEM classes should be migrated or mapped. (This is an implementation decision for the `implement` agent, not research.)

### Streaming / Callback Conclusion

**The shared list does NOT need raw `CliStreamEvent` handling.** Confirmed by reading `ChatMessages.tsx:9-21`: it consumes only `messages: CliMessage[]` + `isStreaming: boolean` + `chatMode` + `onSaveToWiki`. It never touches the adapter or event handlers.

Therefore the unified contract is:

- The shared component tree (`ChatInputBox` + the shared message list) only needs:
  - `messages: CliMessage[]` (from `@quill/cli-adapter` — the shared message type)
  - `streaming: boolean`
- **Stores stay separate.** Each side keeps its own store (`petChatStore` flat-string messages vs `aiStore` rich `CliMessage` sessions) and its own event→message mutation logic:
  - Pet: `petChatService` maps `text/error/done` → `appendToLastMessage`/`setStreaming`.
  - Ai: `AiPanel.eventHandler` maps all 8 variants → `appendToLastMessage`/`appendThinking`/`addToolCall`/`completeToolCall`/`addFileChange`/`setCliSessionId`/`setSessionStreaming`.
- **No unified streaming callback is injected INTO the shared list.** The shared list is a pure view over `(messages, streaming)`. The adapter `onEvent` registration, the event→store mutation, and the `pauseWatcher`/`resumeWatcher` orchestration all remain in the per-side parent (`PetChat` / `AiPanel`).
- The only "contract" the two sides must satisfy to use a shared list is: project their store's messages into `CliMessage[]` and a `streaming: boolean`. Pet's `PetChatMessage` is a strict subset of `CliMessage` (missing `thinking`/`toolCalls`/`attachments`/`role:'system'`), so PetChat would need to either adopt `CliMessage` or map `PetChatMessage → CliMessage` at the boundary. (Pet currently only uses `role:'user'|'assistant'` and `content` — a `PetChatMessage → CliMessage` mapping is trivial: `{...msg, timestamp: msg.ts}`.)

**Caveat — message-type divergence**: Pet's store uses `PetChatMessage` (`{id, role:'user'|'assistant', content, ts}`) while Ai uses `CliMessage` (`{id, role:'user'|'assistant'|'system', content, thinking?, toolCalls?, attachments?, timestamp}`). A truly shared list requires both sides to feed `CliMessage[]`. Pet would need to either (a) switch `petChatStore` to `CliMessage`, or (b) map at the prop boundary. This is an implementation decision.

## Caveats / Not Found

- PetChat's unmount-cleanup effect (`PetChat.tsx:86-97`) deps on `[streaming, setStreaming]`, so the cleanup runs on every streaming-state flip, not strictly on unmount. The behavior is correct (idempotent `resetPetChatAdapter`) but a shared `ChatInputBox` should not replicate this pattern blindly — unmount cleanup should be unmount-only via an empty-deps effect with a ref holding the latest `streaming`.
- AiPanel's `handleSend` mixes prompt-building, blob-saving, @file resolution, adapter start, and event handling in one ~200-line function. A shared `ChatInputBox` does NOT move this logic — it only moves the textarea + toolbar + send/stop toggle. The prompt-building/adapter-start layer stays per-side.
- The hidden file-picker `<input type="file">` lives at the bottom of `ChatInput.tsx` (L347-354); if it moves into a slot, the ref + `onChange` must be threaded through the slot props.
- `aiStore.inputMode` is global (not per-session); the mode dropdown in `ChatInput` reads/writes it directly. If the dropdown moves into a slot, the slot still needs `inputMode` + `setInputMode` (or the AiPanel parent renders the whole dropdown and passes it as a pre-built `leadingSlot` node).
