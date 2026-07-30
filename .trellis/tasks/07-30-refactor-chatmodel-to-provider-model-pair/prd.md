# refactor chatModel to provider+model pair from settings

## Goal

Restructure chatModel so the active (provider, model) pair used by the Chat page
is always derived from `settings.json`'s enabled providers × their
`selectedModelIds`, rather than being a free-form global string. The Chat page
gets a dropdown that lists every enabled provider × selectedModelId pair and
lets the user pick the active one. Test-connection already operates per-
provider-per-model; this refactor aligns the Chat page with that model.

## What I already know

- `chatModel: string` is a global field in `aiConfigStore` (L88), persisted in
  storage.json (`PERSIST_KEYS_AI_CONFIG` L68). `chatProvider` is also a global
  string, and the two are implicitly bound — chatModel is "the model under
  chatProvider".
- Callers of `chatModel` + `chatProvider`:
  - `AiPanel.tsx` L235-244 — main chat send path (`runRigChat`)
  - `useVoiceInput.ts` L250-257 — voice chat
  - `petChatService.ts` L212-213 — pet chat
  - `BubbleTemplateAIChatModal.tsx` — bubble template chat
  - `plugin-host/aiCapability.ts` + `rpcBridge.ts` — plugin AI capability RPC
- `providerSettings[id].selectedModelIds: string[]` (L54, L140) is the
  per-provider "enabled subset" — fetched or manually-added (manual now also
  flows in via `addSelectedModelId`, see b916f25).
- `providerSettings[id].enabled: boolean` is the per-provider on/off flag.
- Test-connection already picks a model per provider via `TestChatModal`'s
  dropdown — that pattern is the model for the Chat page dropdown.

## Assumptions (temporary)

- "Chat page" = `AiPanel.tsx` (right-side AI panel). Dropdown likely lives in
  the panel header or near the input row.
- Dropdown groups by provider; option = `<provider>:<model>`.
- chatProvider + chatModel stay as the active-pair state (no per-session
  override in MVP).
- The refactor does NOT remove chatModel/chatProvider from aiConfigStore —
  they become "the active pair chosen via dropdown" rather than "free-form
  fields". Their setters may be replaced or repurposed.

## Open Questions

(none — all resolved)

## Migration Note

Existing users have only global `chatModel` set. After upgrade:
- Global `chatProvider` + `chatModel` retained as default for new AiPanel
  sessions (no migration needed).
- `petPair` / `bubblePair` / `voicePair` / `pluginPair` start empty; user
  must pick in each respective settings page before that caller works.
  Breaking change for existing voice/pet/bubble/plugin users — they'll see
  an empty-state prompt on first use post-upgrade.

## Requirements (evolving)

- `AiSession` carries its own `provider` + `model` (per-session pair).
- Chat page dropdown lists every `enabled=true` provider × their
  `selectedModelIds` entries; selecting a pair updates the active session's
  `provider` + `model`.
- New AiPanel session default: inherits global `chatProvider` + `chatModel`.
- Disabled providers or models not in `selectedModelIds` don't appear in the
  dropdown.
- Test-connection dropdown stays as-is (per-provider).
- Each non-AiPanel caller (pet, bubble, voice, plugin RPC) has its own pair
  field in `aiConfigStore` (`petPair`, `bubblePair`, `voicePair`,
  `pluginPair`) and its own model picker in its respective settings page
  (`PetSettings`, `BubbleTemplateAIChatModal`, `VoiceSettings`,
  `PluginsSettings`).
- Pet / bubble / voice / plugin RPC chat send paths read from their own pair
  field, not global `chatProvider`/`chatModel`.
- Mid-session pair switch allowed.

## Acceptance Criteria (evolving)

- [ ] `AiSession` has `provider` + `model` fields, persisted with the session.
- [ ] Chat page dropdown shows all enabled provider × selectedModelIds pairs.
- [ ] Selecting a pair updates active session's `provider` + `model`.
- [ ] Switching sessions shows each session's own pair in the dropdown.
- [ ] Creating a new session inherits the global pair as default.
- [ ] If a session's pair is no longer valid, the dropdown falls back to
      first available pair and updates the session.
- [ ] `aiConfigStore` has `petPair` / `bubblePair` / `voicePair` /
      `pluginPair` fields, persisted.
- [ ] Each of `PetSettings`, `BubbleTemplateAIChatModal`, `VoiceSettings`,
      `PluginsSettings` has a model picker dropdown bound to enabled
      providers × selectedModelIds, writing to its own pair field.
- [ ] Pet / bubble / voice / plugin RPC chat send paths read their own pair
      field; no reads of global `chatModel`/`chatProvider` remain on these
      paths.
- [ ] Dropdown is empty when no provider is enabled or no model is selected
      — chat input is disabled with a placeholder + link opening
      `ModelServicesSettings`.
- [ ] Test-connection dropdown still works (regression check).
- [ ] Per-message pair tag: `CliMessage` gains `provider` + `model` fields;
      each AI response is tagged with the pair that produced it. UI renders
      the tag on AI responses.
- [ ] Global `chatProvider`/`chatModel` retained and redefined as "last used
      pair" — every AiPanel dropdown change syncs to global; new sessions
      inherit global pair.
- [ ] Migration: if the persisted chatModel isn't in the persisted
      selectedModelIds of its chatProvider, fall back to first-available pair.

## Definition of Done (team quality bar)

- Tests added/updated (unit/integration where appropriate)
- Lint / typecheck / CI green
- Docs/notes updated if behavior changes
- Rollout/rollback considered if risky

## Decision (ADR-lite)

**Context**: Chat page dropdown lets user pick (provider, model) for the active
chat. Two scope options: global pair (all chat callers follow) vs per-session
pair (each session has its own).

**Decision**: Per-session pair for AiPanel; each non-AiPanel caller (pet,
bubble, voice, plugin RPC) gets its own dedicated pair configured in its own
settings page. Global `chatProvider` + `chatModel` redefined as "last used
pair" — every AiPanel session dropdown change syncs to global; new sessions
inherit global pair as default.

**Consequences**:
- `AiSession` schema gains `provider` + `model` fields (per-session pair,
  dropdown on AiPanel).
- `aiConfigStore` gains per-caller pair fields: `petPair`, `bubblePair`,
  `voicePair`, `pluginPair` (each = `{ provider, model }`).
- `PetSettings`, `BubbleTemplateAIChatModal`, `VoiceSettings`, `PluginsSettings`
  each add a model picker dropdown bound to enabled providers × their
  selectedModelIds.
- AiPanel dropdown `onChange` writes both `session.{provider, model}` and
  global `{chatProvider, chatModel}`.
- Mid-session model switch is supported.

## Out of Scope (explicit)

- Multi-model routing (one chat request fanned out to multiple models).
- Model discovery / fetch from the dropdown (user still goes to Settings to
  fetch & select models).

## Technical Approach

### State shape
- `AiSession` gains `provider: ChatProvider` + `model: string`.
- `CliMessage` gains `provider: ChatProvider` + `model: string` (per-message
  tag; AI responses carry the pair that produced them).
- `aiConfigStore` gains `petPair`, `bubblePair`, `voicePair`, `pluginPair`
  (each `{ provider, model }`).
- Global `chatProvider` + `chatModel` redefined as "last used pair" — every
  AiPanel dropdown `onChange` writes session + global atomically.

### Dropdown component
- New reusable `<PairSelector>` rendered in AiPanel header + each of
  `PetSettings`, `BubbleTemplateAIChatModal`, `VoiceSettings`,
  `PluginsSettings`.
- Options = `PROVIDER_CATALOG + customerProviders` filtered by
  `providerSettings[id].enabled === true` ×
  `providerSettings[id].selectedModelIds`.
- Option label: `<provider display name> : <model id>`.
- Empty state: dropdown shows placeholder text; in AiPanel, chat input is
  disabled with a hint + link to Settings.

### Send paths
- AiPanel: read `activeSession.{provider, model}` → pass to `runRigChat` /
  CLI adapter.
- Pet: read `petPair` → `petChatService`.
- Bubble: read `bubblePair` → bubble modal send.
- Voice: read `voicePair` → `useVoiceInput`.
- Plugin RPC: read `pluginPair` → `aiCapability.runChat`.

### Per-message tag
- `CliMessage` write path: when AI response is appended, copy current session
  pair into the message.
- Render: small tag under AI message bubble showing provider+model.

### Migration
- First load post-upgrade: `petPair`/`bubblePair`/`voicePair`/`pluginPair`
  start empty. Existing global `chatProvider` + `chatModel` retained as last
  used pair (default for new AiPanel sessions). Voice/pet/bubble/plugin users
  see empty-state prompt on first use post-upgrade.

## Implementation Plan (small PRs)

- **PR1 — State schema + types**: Add `provider`+`model` to `AiSession` and
  `CliMessage`; add `petPair`/`bubblePair`/`voicePair`/`pluginPair` to
  `aiConfigStore` with setters; update `PERSIST_KEYS_AI_CONFIG`; add store
  unit tests. No UI changes yet.
- **PR2 — Reusable `<PairSelector>`**: Extract the dropdown component; bind to
  enabled providers × selectedModelIds; empty-state behavior. Add unit tests
  for the option list + empty state.
- **PR3 — AiPanel integration**: Wire PairSelector to AiPanel header; on
  change, write session pair + global pair; chat send path reads from
  session; disable chat input when empty. Update `useVoiceInput` to read
  `voicePair` (no UI yet — voice pair still empty post-upgrade).
- **PR4 — Per-message tag**: `CliMessage` provider+model fields plumbed into
  the AI response append path; render tag in `ChatMessageList`. Tests for
  the tag write/read.
- **PR5 — Per-caller settings dropdowns**: Add `<PairSelector>` to
  `PetSettings`, `BubbleTemplateAIChatModal`, `VoiceSettings`,
  `PluginsSettings`. Send paths for pet/bubble/voice/plugin RPC switched to
  read per-caller pair field. Migration note documented.
- **PR6 — Migration + polish**: Storage migration bumps (if any schema
  incompatibility surfaces); empty-state link to Settings; regression
  pass on test-connection dropdown; final type check + tests.
