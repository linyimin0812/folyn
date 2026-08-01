# AiPanel follow-ups: dedup tabs, disable @ in Chat mode, Agent CLI tag

## Goal

Three follow-up fixes to the AiPanel / ChatInput area, surfaced after the
clickable-path task shipped:

1. Clicking a file-path link opens a duplicate tab when the file is already
   open in the editor. Root cause: the AI often returns absolute paths
   (`/Users/.../apps/desktop/src/foo.ts`) which `editorIoService.openFile`
   routes as external (`ext:` namespace), even when the same file is
   already open as a vault-relative tab. The two tabs have different IDs
   so neither finds the other.

2. Chat mode (rig backend, no tools) shouldn't trigger the `@`-mention
   menu — the rig backend has no file tools, so an `@`-inserted attachment
   is dead weight. Ask/Agent (CLI adapter, has tools) keep `@`.

3. For non-Chat modes (Ask/Agent), the per-bubble "provider | model" tag
   is wrong — those messages come from the CLI adapter, not the rig LLM
   pair. Show an "Agent CLI" tag instead.

## Requirements

- **R1 (dedup)**: When the user clicks an absolute path that points inside
  the active vault's `basePath`, normalize it to a vault-relative path
  BEFORE calling `editorIoService.openFile`. Both `resolvePath` (existence)
  and `handlePathClick` (open) must use the normalized form so the tab ID
  matches an already-open vault tab.
- **R2 (disable @ in Chat)**: `ChatInput.handleChange` must not open the
  `@`-mention menu when `isRigMode(inputMode) === true`. The `@` character
  is left in the textarea as plain text.
- **R3 (Agent CLI tag)**: `renderPairTag` in `AiPanel` returns the existing
  `<PairTag>` for Chat (rig) sessions; for Ask/Agent sessions it returns a
  new lightweight `<AgentCliTag>` showing "Agent CLI" + the active input
  mode label (e.g. "Agent" / "Ask"). Falls back to nothing when no
  `inputMode` is set.

## Acceptance Criteria

- [ ] Clicking an absolute path that resolves inside the active vault
      focuses the existing vault tab (no new tab).
- [ ] Clicking an absolute path OUTSIDE the vault still opens as external
      (existing behavior preserved).
- [ ] Typing `@foo` in Chat mode does NOT show the mention menu; `@foo`
      stays as plain text.
- [ ] Typing `@foo` in Agent/Ask mode still opens the mention menu.
- [ ] Assistant bubble pair tag in Chat mode shows provider icon + name +
      model (unchanged).
- [ ] Assistant bubble pair tag in Agent mode shows "Agent CLI" + "Agent"
      label; Ask mode shows "Agent CLI" + "Ask".
- [ ] Unit test: absolute path inside vault basePath is normalized to
      vault-relative (paths outside vault basePath are left as external).

## Definition of Done

- Tests added/updated.
- Lint / typecheck / CI green.
- No new dependencies.

## Out of Scope

- Cursor re-jump when clicking a path that points at the already-active
  file (the existing EditorPane `key` includes `activeTab?.id` and won't
  remount on re-activation — deferred from the prior task).
- Replacing the Ask/Agent CLI identity with a richer adapter metadata
  surface (just the mode label for now).
- Pet chat (vault-free, no @-mention, no pair tag — unchanged).

## Technical Approach

### R1 — Path normalization (in `components/ai/AiPanel.tsx`)

Add a helper that, given a raw path, returns the form to pass into
`openFile` / existence-check:

```ts
function normalizeVaultPath(raw: string, vault: VaultConfig | null): string {
  if (!vault || !isExternalPath(raw)) return raw;
  const base = vault.basePath.replace(/\/+$/, '');
  if (raw === base || raw.startsWith(base + '/')) {
    return raw.slice(base.length).replace(/^\/+/, '');
  }
  return raw; // external, leave as-is
}
```

Apply in both `resolvePath` (check `allFiles.some(f => f.path === normalized)`)
and `handlePathClick` (call `openFile(normalized, name)`).

### R2 — @-mention gate (in `components/ai/ChatInput.tsx`)

In `handleChange`, short-circuit the `@` detection when `rigMode` is true:

```ts
if (!rigMode) {
  // existing @-mention detection
}
```

`rigMode` is already computed at line 87.

### R3 — AgentCliTag (new component, in `components/ai/`)

Tiny presentational component:

```tsx
function AgentCliTag({ modeLabel }: { modeLabel: string }) {
  return (
    <>
      <Bot size={13} />
      <span className="font-semibold text-t2">Agent CLI</span>
      <span className="text-t3">|</span>
      <span className="text-t3">{modeLabel}</span>
    </>
  );
}
```

`renderPairTag` in AiPanel decides: if `isRigMode(activeSession?.inputMode)`
→ `<PairTag>` (existing); else → `<AgentCliTag modeLabel={modeLabel}>`.
The slot signature `(msg) => ReactNode | null` is preserved.

### R4 — AgentCliTag shows real CLI identity (revision of R3)

Replace the generic `Bot` icon + "Agent CLI" label with the active CLI
adapter's icon (claude_code.svg / pi.svg) + `displayName` ("Claude Code" /
"Pi") from `listAdapters()` + `aiConfig.cliAdapter`. Mode label still
follows `getInputModeDef(modeId).label`. Icon lookup mirrors
`AdapterSelector`'s `ADAPTER_ICON` map.

### R5 — Unlock AdapterSelector mid-session

`AdapterSelector` was disabled via `sessionLocked = Boolean(session.cliSessionId)`
once the session had talked to a backend, forcing the user to start a new
session to switch CLI. Drop the `sessionLocked` gate; only `isStreaming`
disables now. Switching adapter mid-session is permitted — the next send
runs under the new adapter.

## Technical Notes

- `apps/desktop/src/components/ai/AiPanel.tsx:67-95` — `resolvePath` +
  `handlePathClick` already wired; add normalization.
- `apps/desktop/src/components/ai/ChatInput.tsx:87` `rigMode` flag exists.
- `apps/desktop/src/components/ai/ChatInput.tsx:186-202` `handleChange`
  @-detection.
- `apps/desktop/src/components/ai/AiPanel.tsx:73-76` `renderPairTag` slot.
- `apps/desktop/src/components/ai/inputModes.ts:103` `isRigMode`.
- `apps/desktop/src/components/chat/PairTag.tsx` — reference for the
  presentational shape `AgentCliTag` should mirror.
- `packages/vault-provider/src/types.ts:67` `VaultConfig.basePath`.

## R6 — Mid-session locks: mode dropdown + Agent CLI selector

### Semantics

User feedback: after a session has started (any message sent), do not allow
switching the input mode (Chat / Agent / Ask). Chat mode's Model (provider
pair) selector stays unlocked. Agent/Ask mode's Agent CLI selector goes
back to session-locked (partial revert of R5).

1. **Mode dropdown trigger locked once session started** — the icon-only
   mode toggle button in `ChatInput.leadingSlot` gains
   `disabled={isStreaming || sessionStarted}`. The existing
   `disabled:opacity-40 disabled:cursor-not-allowed` classes carry the
   visual state.
2. **PairSelector stays unlocked** — Chat mode keeps allowing mid-session
   provider/model switching (no `sessionStarted` gate on `PairSelector`).
   This is the user's explicit ask.
3. **AdapterSelector re-locked** — `AdapterSelector disabled={isStreaming || sessionStarted}`
   for Agent/Ask modes. R5 unlocked it fully; R6 re-adds the session-lock.

### "Session started" signal

Use `Boolean(sess && sess.messages.length > 0)` rather than R5's removed
`Boolean(session.cliSessionId)`. Rationale: rig/Chat mode never sets
`cliSessionId` (the rig backend isn't a CLI adapter), but a Chat session
with messages is still "started" and the mode dropdown should be locked.
`messages.length > 0` covers both backends uniformly.

### Partial revert of R5

R5 fully unlocked `AdapterSelector` (dropped `sessionLocked`). R6 re-adds
a session-started lock to `AdapterSelector` AND extends the same lock to
the mode dropdown trigger (new — R5 didn't touch the mode dropdown).
`PairSelector` is deliberately left unlocked.

### Implementation touchpoints

- `apps/desktop/src/components/ai/ChatInput.tsx` — add `sessionStarted`
  memo (derive from `sessions` + `activeSessionId`, both already
  selected), gate the mode trigger button + `AdapterSelector`.
- No `aiStore` / `CliMessage` type changes.
- No new tests (UI behavior adjustment; existing smoke tests cover
  render).

### Out of scope

- Per-message mode stamp (an earlier draft tried adding `inputMode` to
  `CliMessage` to render a per-bubble mode label — abandoned; session-level
  lock is the chosen solution).
- Pet chat (vault-free, no mode dropdown, no adapter selector).
