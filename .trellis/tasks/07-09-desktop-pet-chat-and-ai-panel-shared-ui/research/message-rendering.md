# Research: Message-rendering & message-list layer of both chat UIs

- **Query**: Deep-read the message-list + bubble + content-rendering layer of PetChat and AiPanel to inform extracting a shared `ChatMessageList` + `MessageContent`.
- **Scope**: internal
- **Date**: 2026-07-09

## Findings

### Files Found

| File Path | Description |
|---|---|
| `apps/desktop/src/components/pet/PetChat.tsx` | Pet-side: list + bubble + copy + clear + empty-state all inline (no sub-components). BEM classes `pet-chat-*`. |
| `apps/desktop/src/components/pet/pet.css` (L459-668) | `pet-chat-*` BEM styles. Plain-text rendering (`white-space: pre-wrap`), no markdown. |
| `apps/desktop/src/store/petChatStore.ts` | `PetChatMessage = {id, role:'user'\|'assistant', content, ts}`. Persisted namespace `pet-chat:messages`. `streaming` runtime-only. |
| `apps/desktop/src/components/ai/AiPanel.tsx` | Ai-side host. Renders `<ChatMessages>` inside `.ai-body`. Owns sessions/modes/attachments logic. |
| `apps/desktop/src/components/ai/ChatMessages.tsx` | Ai-side: list + row + thinking `<details>` + ToolCallBlock + attachments + FileImage + wiki-save button. Tailwind utility classes. |
| `apps/desktop/src/components/ai/MessageContent.tsx` | Markdown pipeline: unified→remark-parse→remark-gfm→remark-rehype→rehype-highlight→rehype-react. Wraps in `.msg-md`. |
| `apps/desktop/src/components/ai/ToolCallBlock.tsx` | `ToolCallInfo[]` → collapsible per-call items with ErrorBoundary, spinner/check status, input/output `<pre>`. |
| `apps/desktop/src/components/ai/FileImage.tsx` | Reads file bytes via `@tauri-apps/plugin-fs`, builds blob URL. Tauri-only (fails gracefully to `🖼 name` fallback). |
| `apps/desktop/src/index.css` (L129-221) | `.ai-body` scrollbar, `.ai-session-streaming` pulse dot, `.msg-thinking*`, `.cursor-blink`, `.ai-streaming-indicator/dots`, `.msg-md*` markdown styles. |
| `packages/cli-adapter/src/types.ts` | `CliMessage = {id, role:'user'\|'assistant'\|'system', content, thinking?, toolCalls?, attachments?, timestamp}`. |

### 1. Message list

**PetChat** (`PetChat.tsx:173-208`):
- Container: `<div className="pet-chat-messages" role="log" aria-live="polite">`.
- Mapping: `messages.map((m) => <div key={m.id} className="pet-chat-bubble pet-chat-bubble-${m.role}">…)`.
- Auto-scroll: `messagesEndRef = useRef<HTMLDivElement>(null)`; `useEffect` dep `[messages]` → `messagesEndRef.current?.scrollIntoView({behavior:'smooth', block:'end'})`. Sentinel `<div ref={messagesEndRef} />` at end.
- Empty state: `messages.length === 0 && <div className="pet-chat-hint">向 AI 提问…</div>`.
- Streaming indicator: none at list level — inline per-bubble: empty content shows `…` while streaming (`m.content || (streaming ? '…' : '')`). No 3-dot/cursor block.
- Clear button: rendered OUTSIDE the list, below input row, only when `messages.length > 0`, disabled while streaming.

**AiPanel / ChatMessages** (`ChatMessages.tsx:16-105`):
- Container: `<div className="flex flex-col gap-2 flex-1">` (Tailwind), hosted by `.ai-body` in `AiPanel.tsx:486`.
- Mapping: `messages.map((msg) => <div key={msg.id} className="py-2 px-2.5 rounded-lg ${role…}">…)`.
- Auto-scroll: same pattern — `msgsEndRef`, `useEffect` dep `[messages]` → `scrollIntoView({behavior:'smooth'})` (no `block`). Sentinel `<div ref={msgsEndRef} />`.
- Empty state: a centered block with ✦ icon + two lines (`text-[13px]` / `text-[11px]`).
- Streaming indicator (list-level, AFTER all messages): when `isStreaming` → `<div className="ai-streaming-indicator"><div className="ai-streaming-dots"><span/><span/><span/></div><span>AI 正在处理...</span></div>`. PLUS per-bubble cursor `▎` (`cursor-blink`) on the last assistant message while streaming (`ChatMessages.tsx:76-80`).

### 2. Message bubble / row

**PetChat** (`PetChat.tsx:177-205`) — BEM, compact, no markdown, no tools, no attachments:
- `pet-chat-bubble pet-chat-bubble-{role}` (user = blue bg right-aligned; assistant = grey bg left-aligned).
- `pet-chat-bubble-role` → text `我` / `AI`.
- `pet-chat-bubble-content` → renders `m.content` as plain text via `white-space: pre-wrap` (CSS L508-514). NO markdown.
- Copy button (assistant + has content): `pet-chat-copy` icon button bottom-right of bubble; toggles to check svg for 1.2s.
- No timestamp display, no thinking, no toolCalls, no attachments.

**AiPanel / ChatMessages** (`ChatMessages.tsx:32-92`) — Tailwind, full feature set:
- Row: `py-2 px-2.5 rounded-lg` + role-based (`user`: `bg-accdim self-end max-w-[90%]`; `assistant`: `bg-surf border border-brd`).
- Role label: `text-[9px] font-semibold text-t3 mb-1 uppercase` showing `AI` / `你`. For user messages with `msg.timestamp`: a formatted `zh-CN` date string (`yyyy-MM-dd HH:mm:ss`) is appended inline.
- Thinking: `<details className="msg-thinking" open={isStreaming && isLast}>` with `msg-thinking-label` summary + `msg-thinking-body` (CSS L182-187, purple left-border).
- ToolCalls: `<ToolCallBlock toolCalls={msg.toolCalls} />` when `msg.toolCalls?.length > 0`.
- Attachments: flex-wrap of chips; image attachments render `<img>` (previewUrl) or `<FileImage>` (path) or fallback `🖼 name`; file attachments render `<FileIcon>` + name chip.
- Content: assistant+content → `<MessageContent content={msg.content} />` (markdown); otherwise plain `msg.content`. Last assistant msg while streaming appends `<span className="cursor-blink">▎</span>`.
- Wiki-save button (assistant, `chatMode==='wiki'`, content present, `onSaveToWiki` provided): border-acc outline button `保存到 Wiki`.
- No copy button (gap to port).

### 3. Content rendering

- **PetChat**: plain text only. `{m.content}` rendered into `.pet-chat-bubble-content` whose CSS sets `white-space: pre-wrap` (L508-514). No markdown dependency.
- **AiPanel**: `MessageContent.tsx` builds a module-level `unified()` processor: `remarkParse → remark-gfm → remark-rehype → rehype-highlight({detect:true}) → rehype-react({createElement, Fragment, jsx, jsxs})`. `useMemo([content])` runs `processor.processSync(content)`, returns `result.result` as `React.ReactNode`; on empty/whitespace returns `null`; on throw returns raw `content`. Wrapped in `<div className="msg-md">`. CSS `.msg-md*` (L206-221) styles p/ul/ol/li/code/pre/h1-4/blockquote/a/table.

**Plaintext mode on shared `MessageContent`**: add a `plaintext?: boolean` prop. When true, skip the `unified` pipeline entirely and render `<div className={className}>{content}</div>` (with `white-space: pre-wrap` supplied by the consumer's class). PetChat passes `plaintext`; AiPanel omits it. The module-level `processor` import (remark/rehype) is the heavy dependency — gating it behind a prop is runtime-trivial, but to keep it out of the pet-panel *bundle* the prop alone isn't enough (top-level `import` still pulls the pipeline in). See Caveats.

### 4. Copy button

PetChat implementation (`PetChat.tsx:44-54, 128-136, 181-204`):
- `copyToClipboard(text)` helper: `isTauri()` guard → dynamic `import('@tauri-apps/plugin-clipboard-manager')` → `mod.writeText(text)` → returns boolean. Errors logged, swallowed.
- `handleCopy(id, text)`: on success sets `copiedId=id`, schedules `setTimeout(1200)` to clear if still that id.
- Bubble markup: `<button className="pet-chat-copy" aria-label={copiedId===id?'已复制':'复制'} aria-pressed={copiedId===id}>` containing `.pet-chat-copy-icon` with two svg variants (copy rects vs check path).
- CSS (`.pet-chat-copy`, L521-551): 20×20 transparent, `align-self:flex-end`, hover bg, `aria-pressed` turns accent color.

AiPanel has NO copy button — this is the exact code to port into the shared bubble.

### 5. Message type shape

| Field | `PetChatMessage` | `CliMessage` | Adaptation |
|---|---|---|---|
| id | `string` | `string` | same |
| role | `'user'\|'assistant'` | `'user'\|'assistant'\|'system'` | subset — OK |
| content | `string` | `string` | same |
| ts | `number` (Date.now()) | — | rename `ts` → `timestamp` |
| timestamp | — | `number` | the canonical field |
| thinking | — | `string?` | undefined on pet side |
| toolCalls | — | `ToolCallInfo[]?` | undefined on pet side |
| attachments | — | `MessageAttachment[]?` | undefined on pet side |

Adaptation for shared list typed on `CliMessage`: pet store emits `{id, role, content, ts}` → map at the PetChat boundary to `{id, role, content, timestamp: ts}` (thinking/toolCalls/attachments left undefined). The `role` union widens to include `'system'` harmlessly. The shared component should treat `timestamp` as optional for display (pet doesn't show it; ai shows it only for user msgs).

### Tauri-window isolation

- `MessageContent.tsx` imports ONLY: `react` (`useMemo`, `createElement`, `Fragment`), `unified`, `remark-parse`, `remark-gfm`, `remark-rehype`, `rehype-highlight`, `rehype-react`, `react/jsx-runtime`. **No vault/editor/ai stores.** Safe for top-level import into the pet-panel window.
- `ChatMessages.tsx` imports `AiChatMode` from `@/store/aiStore` (type-only), `MessageContent`, `ToolCallBlock`, `FileImage`, `FileIcon`. `AiChatMode` is a type so it erases at runtime; but `ToolCallBlock`/`FileImage` pull in `@quill/cli-adapter` types (type-only) and `@tauri-apps/plugin-fs` (runtime, guarded). A shared `ChatMessageList` should NOT import `AiChatMode` — pass `onSaveToWiki?` + a generic mode flag instead, or drop the wiki-save button out of the shared core and let AiPanel wrap/slot it.
- `PetChat.tsx` lives in the pet-panel window which must NOT import vault/editor stores (confirmed: it imports only `settingsStore`, `petChatStore`, `petChatService`, `platform` util). The shared component must preserve this — no top-level `aiStore`/`vaultStore`/`editorStore` imports.

## Proposed Props Contracts

### `ChatMessageList`

```ts
interface ChatMessageListProps {
  /** Messages to render. Canonical type = CliMessage. Pet side adapts
   *  {id,role,content,ts} → {id,role,content,timestamp:ts}. */
  messages: CliMessage[];
  /** True while the last assistant message is streaming. Drives the
   *  streaming indicator + per-bubble cursor + auto-scroll. */
  streaming: boolean;
  /** Optional clear button (PetChat shows one; AiPanel does not). */
  onClear?: () => void;
  /** Custom empty-state node. Falls back to a default hint. */
  emptyState?: React.ReactNode;
  /** Override the row renderer (e.g. AiPanel's wiki-save button, pet's
   *  copy button). Defaults to the built-in row. */
  renderMessage?: (msg: CliMessage, isLast: boolean) => React.ReactNode;
  /** Plaintext mode: when true, assistant content is rendered as plain
   *  text (pre-wrap) instead of via the markdown pipeline. PetChat=true,
   *  AiPanel=false. */
  plaintext?: boolean;
  /** Optional copy-button support (PetChat=true to show on assistant
   *  bubbles with content). AiPanel omits. */
  showCopy?: boolean;
  onCopy?: (msg: CliMessage) => void;
  /** Session-switch props — OPTIONAL, only used if the host wants the
   *  built-in session list header. AiPanel provides these; PetChat does
   *  not (single session). Keeping them here lets AiPanel render the
   *  header above the list, OR the host renders the header itself and
   *  leaves these unset. Simpler: leave sessions OUT of the shared list
   *  and let each host own its header. */
  // sessions?: SessionMeta[];        // intentionally omitted
  // activeSessionId?: string;        // intentionally omitted
  // onSwitchSession?: (id: string) => void;
  /** Streaming-indicator style: 'dots' (AiPanel, 3-dot block) | 'cursor'
   *  (PetChat, inline ▎) | 'none'. Default 'dots'. */
  streamingIndicator?: 'dots' | 'cursor' | 'none';
  /** Extra className for the scroll container. */
  className?: string;
}
```

Auto-scroll strategy: `useRef` sentinel `<div>` at end + `useEffect([messages, streaming])` → `scrollIntoView({behavior:'smooth', block:'end'})`. Same in both current implementations.

How each side renders:
- **PetChat**: `<ChatMessageList messages={petMsgsAsCli} streaming={streaming} plaintext onClear={clear} showCopy onCopy={handleCopy} streamingIndicator="cursor" emptyState={<hint/>} />` — no thinking/toolCalls/attachments (undefined), no wiki-save.
- **AiPanel**: `<ChatMessageList messages={messages} streaming={isStreaming} streamingIndicator="dots" renderMessage={(m,isLast)=> <AiRow … onSaveToWiki …/>} />` — full markdown, tools, attachments, thinking. OR pass `plaintext={false}` (default) and let the built-in row handle thinking/tools/attachments/wiki-save via optional props.

### `MessageContent`

```ts
interface MessageContentProps {
  /** The message text to render. */
  content: string;
  /** When true, skip the unified/remark/rehype markdown pipeline and
   *  render the raw text in a pre-wrap container. PetChat sets this;
   *  AiPanel leaves it false (default). */
  plaintext?: boolean;
  /** Extra class on the wrapper. Markdown mode applies `.msg-md`;
   *  plaintext mode applies the caller's class (which should set
   *  `white-space: pre-wrap`). */
  className?: string;
}
```

Markdown-pipeline gating:
- `plaintext === true` → `return <div className={className ?? 'msg-md-plain'}>{content}</div>` (no `unified` call).
- `plaintext` falsy → current behavior: `useMemo` runs `processor.processSync(content)`, wraps in `<div className="msg-md {className}">`.

Bundle caveat: a static `import {unified} from 'unified'` (and remark/rehype) at the top of the shared `MessageContent.tsx` will be bundled into the pet-panel window even when `plaintext=true` at runtime. To keep the pet-panel bundle lean, either (a) accept the cost (pipelines are ~tree-shakeable to some degree), (b) lazy-load the markdown processor via dynamic `import()` inside the `!plaintext` branch, or (c) ship two entry components (`MessageContent` markdown + `PlainTextContent`) and let each host import only what it needs. Option (b) is the cleanest for a single shared file.

## Caveats / Not Found

- **Streaming-indicator divergence**: PetChat has NO list-level 3-dot block (only per-bubble `…` placeholder + no cursor). AiPanel has BOTH a list-level `ai-streaming-indicator` 3-dot block AND a per-bubble `cursor-blink` ▎. The shared component must let the host pick via `streamingIndicator`. The PetChat `…` placeholder for empty streaming assistant content is a separate behavior — consider folding it into `MessageContent` (empty content + streaming → render `…`) or leaving it host-owned.
- **Wiki-save button** is AiPanel-specific (`chatMode==='wiki'`). Cleanest: keep it OUT of the shared `ChatMessageList` core and let AiPanel supply it via `renderMessage` slot, OR add an optional `onSaveToWiki?: (content:string)=>void` prop that, when present, shows the button on assistant messages.
- **Session list header** (sessions/activeSessionId/onSwitchSession) is intentionally left OUT of `ChatMessageList` — both hosts render their own header (AiPanel has a session dropdown; PetChat has none). Putting session management inside the list would couple the pet panel to session concepts it doesn't have.
- **Bundle isolation** of the markdown pipeline from the pet-panel window is the main open question — see "Bundle caveat" above. Not resolved by props alone.
- **`FileImage`** uses `@tauri-apps/plugin-fs` (runtime import, guarded). Pet side currently never passes attachments, so it won't mount `FileImage`; but if the shared list imports `FileImage` at top level, the plugin-fs import is pulled into the pet bundle. Consider lazy-loading `FileImage` only when `msg.attachments` is non-empty.
- No existing spec under `.trellis/spec/` documents a shared `ChatMessageList`/`MessageContent` contract (only `directory-structure.md` mentions the ai components). The shared-component extraction is net-new.
