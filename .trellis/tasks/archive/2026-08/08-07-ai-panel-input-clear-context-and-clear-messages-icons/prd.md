# PRD: AI Panel input — clear context & clear messages icons

## Goal
Add two icon buttons to the AI Panel input box's trailing slot (left of send): "清除上下文" (clear context) and "清空消息" (clear messages).

## Behavior
- **清除上下文** (Eraser icon): clears `cliSessionId` + `fileChanges` on the active session, keeps `messages` visible. Effect: next user message starts a fresh CLI adapter session, agent forgets prior context, chat log remains.
- **清空消息** (Trash2 icon): reuses existing `aiStore.clearMessages()` — wipes `messages` + `fileChanges` + `cliSessionId`.

Both buttons: ghost icon button style (matching existing `w-7 h-7` pattern), with `title` tooltip + i18n label, no confirm dialog (matches existing `clearMessages` ergonomics).

## Implementation
1. `apps/desktop/src/store/aiStore.ts`: add `clearContext()` action next to `clearMessages` (nulls `cliSessionId`, empties `fileChanges`, keeps `messages`, persists). Export in store type.
2. `apps/desktop/src/components/ai/ChatInput.tsx`: import `Eraser, Trash2` from lucide-react; pass a `trailingSlot` containing two ghost icon buttons wired to `clearContext()` and `clearMessages()` from the store. Add i18n keys.
3. `apps/desktop/src/locales/*`: add `clearContext` / `clearMessages` label keys (zh + en).

## Out of scope
- Confirmation dialog.
- Undo.
- Visual distinction beyond icon + tooltip.
