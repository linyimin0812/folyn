# Extract shared AI chat render layer (scope-corrected)

## Goal

The architecture-rot assessment flagged "three AI chat surfaces (`AiPanel`/`PetChat`/`ChatMessageList`) each independently import `ToolCallBlock`/`FileImage`/`FileIcon`" as duplication to extract. **Verification shows that assessment was stale** — the shared render layer already exists:

- `components/chat/ChatMessageList.tsx` IS the shared chat renderer. Both `ai/AiPanel.tsx:24/486` and `pet/PetChat.tsx:14/455` already consume it.
- `ToolCallBlock` lives in `ai/ToolCallBlock.tsx`; `FileImage` lives in `ai/FileImage.tsx`; `FileIcon` already lives in `icons/FileIcon.tsx`. No rendering is triplicated.

The **actual** remaining debt is the explicit `TODO(PR2)` at `chat/ChatMessageList.tsx:5-9`: the chat package imports `ToolCallBlock` + `FileImage` from `../ai/`, creating a `chat → ai` dependency edge. Worse, it's a **bidirectional cycle** — `ai/` already imports `chat/` (`AiPanel`→`ChatMessageList`, `ChatInput`→`ChatInputBox`), so `ai ↔ chat` is a real cycle, contradicting the TODO's "one-directional (chat → ai, never ai → chat)" claim.

So the real task: **break the `ai ↔ chat` cycle** by relocating `ToolCallBlock` + `FileImage` out of `ai/`. `FileIcon` is already in `icons/` — no change.

## What I already know (verified from repo)

Consumer scan (non-test files):
- `ToolCallBlock` imported by: `chat/ChatMessageList.tsx` only. `ai/` does NOT use it elsewhere.
- `FileImage` imported by: `chat/ChatMessageList.tsx` only.
- `FileIcon` imported by: `chat/ChatMessageList.tsx` + `pet/PetChat.tsx` — already shared via `@/components/icons/FileIcon`. No change needed.

Cycle evidence (ai → chat):
- `ai/AiPanel.tsx:24,29,30` imports `ChatMessageList`, `saveBlobs`/`buildReadInstructions`, `SavedAttachment` from `@/components/chat`.
- `ai/ChatInput.tsx:8,9,16` imports `ChatInputBox`, `PendingAttachment`, more from `@/components/chat`.

chat → ai edge (the one to break):
- `chat/ChatMessageList.tsx:10` `import { ToolCallBlock } from '../ai/ToolCallBlock';`
- `chat/ChatMessageList.tsx:11` `import { FileImage } from '../ai/FileImage';`

No paired tests for `ToolCallBlock` / `FileImage` (`ai/ToolCallBlock.test.*`, `ai/FileImage.test.*` do not exist). `chat/index.ts` does not re-export them (they were ai-internal; now chat-internal).

`ToolCallBlock.tsx` imports: react + `ToolCallInfo` type from `@folyn/cli-adapter` (neutral layer). `FileImage.tsx` imports: react only. Neither reaches into `ai/` — so moving them to `chat/` keeps chat's deps pointing only at neutral layers (icons, types, utils, cli-adapter). Good.

## Requirements

1. `git mv` `apps/desktop/src/components/ai/ToolCallBlock.tsx` → `apps/desktop/src/components/chat/ToolCallBlock.tsx`.
2. `git mv` `apps/desktop/src/components/ai/FileImage.tsx` → `apps/desktop/src/components/chat/FileImage.tsx`.
3. Update `chat/ChatMessageList.tsx`:
   - `import { ToolCallBlock } from '../ai/ToolCallBlock';` → `from './ToolCallBlock';`
   - `import { FileImage } from '../ai/FileImage';` → `from './FileImage';`
   - Remove the `TODO(PR2)` comment block (lines 5-9) — the relocation it asked for is now done.
4. Do NOT add `ToolCallBlock`/`FileImage` to `chat/index.ts` — no external consumer needs them; they're chat-internal. (YAGNI; promote to index if a future non-chat consumer appears.)
5. Verify zero other references to the old `ai/ToolCallBlock` / `ai/FileImage` paths (confirmed: only ChatMessageList).

## Acceptance Criteria

- [ ] `chat/ToolCallBlock.tsx` and `chat/FileImage.tsx` exist; `ai/ToolCallBlock.tsx` and `ai/FileImage.tsx` no longer exist.
- [ ] `chat/ChatMessageList.tsx` imports both from `./` (relative), no `../ai/` import remains.
- [ ] `TODO(PR2)` comment block removed.
- [ ] `grep -rn "from.*ai/ToolCallBlock\|from.*ai/FileImage" apps/desktop/src` returns zero hits.
- [ ] `npx tsc -b` clean for changed files (no new errors; pre-existing `tsconfig.node` config error untouched).
- [ ] `npx vitest run --project desktop` — no regression vs. baseline (the same pre-existing failures, nothing new).

## Definition of Done

- typecheck + vitest green (modulo pre-existing failures).
- No behavior change — pure file move + import path rewrite.
- Spec sync: `directory-structure.md` already documents `chat/` as the shared chat UI consumed by both AI panel and pet chat — verify the `chat/` entry mentions `ToolCallBlock`/`FileImage` or leave as-is if it only lists the public exports. Update only if the spec lists ai-internal files that moved.

## Decision (ADR-lite)

**Context**: The shared chat render layer (`ChatMessageList`) was already extracted in a prior PR; what remained was a `chat → ai` import edge for two chat-internal components (`ToolCallBlock`, `FileImage`), which together with the existing `ai → chat` edge formed a bidirectional cycle. The `TODO(PR2)` at `ChatMessageList.tsx:5` flagged this for follow-up.

**Decision**: Move both files into `chat/` (the sole consumer) rather than a new `components/shared/`. Both files are chat-internal (no ai/ or other-domain consumer); `shared/` would be speculative. `FileIcon` is untouched (already in `icons/`).

**Consequences**:
- The `ai ↔ chat` cycle is broken; `chat/` depends only on neutral layers (icons/types/utils/cli-adapter), `ai/` depends on `chat/` one-way.
- Two files move within `components/`; diff is tiny.
- No public API change (neither file was in `chat/index.ts`).
- Risk: low — mechanical move; a missed import would fail typecheck immediately.

## Out of Scope

- `components/shared/` namespace (YAGNI — no cross-domain consumer exists).
- Promoting `ToolCallBlock`/`FileImage` to `chat/index.ts` exports (no external consumer).
- `FileIcon` — already shared, no work.
- Any change to `AiPanel`/`PetChat` rendering (they already use `ChatMessageList`).
- The other two architecture-rot ROI items (`vault-provider` single-impl abstraction, `commands.rs` domain split) — separate tasks.

## Technical Notes

- `git mv` preserves history; no content change to the two moved files.
- The cycle was real, not just the TODO's stated one-directional coupling — `ai/AiPanel.tsx` + `ai/ChatInput.tsx` already import from `@/components/chat`. After this change the direction is `ai → chat` only.
- Baseline test failures (pre-existing, proven unrelated in the prior task): `file-types/csv`, `file-types/html`, `file-types/json/toExcel`, `pet/PetPanelApp` — these must remain the only failures.
