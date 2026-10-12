# External Sessions

> How Folyn reads external coding-agent sessions (Codex / Claude Code / pi) and captures selected content as vault knowledge.

---

## Overview

`apps/desktop/src/services/externalSessions/` is a **read-only** module: it discovers and parses local persisted sessions from three source tools, projects them into a shared display model, and saves user-selected content (verbatim excerpt or AI-organized note) into the current vault as Markdown + a companion evidence bundle.

UI layout (do not regress to the pre-restructure design): the Sessions **list** is the built-in sidebar panel (id `sessions`, 224px, FilesPanel row conventions); opening a session renders `SessionDetailView` / `EvidenceViewer` **in the main work area** (WorkArea's empty-state branch gates on `activePanel === 'sessions'`; `detectActivity` always returns `'files'`, so no tab ever carries `activity === 'sessions'`). Shared UI state lives in `sessionsUiStore` (zustand; reads reset selection + gen state atomically so a selection never retargets).

This spec is mandatory when adding a new source adapter, changing the capture/evidence/locator formats, or extending selection semantics.

---

## Scenario: Add or Modify a Source Adapter

### 1. Scope / Trigger

- Adding a fourth external tool source
- Changing a source's parsing, discovery, or branch projection

### 2. Signatures

```ts
// types.ts — the contract every adapter satisfies
type ExternalSessionSource = 'codex' | 'claude' | 'pi';
interface ExternalSessionSummary {
  source: ExternalSessionSource;
  sessionId: string;        // native id (session identity = source + sessionId)
  filePath: string;         // absolute path to the physical record file
  title: string;            // native title or first user text
  project: string;          // recorded cwd — NEVER the encoded dir slug
  updatedAt: number;        // file mtime, not a full read
}
interface ExternalSessionMessage {
  id: string;               // native message id when present, else derived
  role: 'user' | 'assistant';
  content: string;          // CANONICAL TEXT: concatenated verbatim text parts
  rawRecord: string;        // verbatim raw record (evidence) — empty for ranged-only
  rawToolRecords: string[]; // associated tool call/result records
  attachments: ...;
}
interface ExternalSessionDetail {
  summary: ExternalSessionSummary;
  messages: ExternalSessionMessage[];   // display projection
  warnings: string[];                   // honest per-session anomaly notes
  branch: { currentId: string; all: ExternalSessionBranch[] };
}
```

Adapters take an injectable fs port (`CodexSessionFs`-style: read/exists/stat/list only — no write method exists in the read port), discovered via `index.ts` with **per-source error isolation**: one source throwing must not remove the others from the list.

### 3. Contracts

- **Read-only**: never write, resume, migrate, or spawn the source tool. Parse persisted files directly (`~/.codex/sessions/**` + `~/.codex/archived_sessions`, `~/.claude/projects/**`, `~/.pi/agent/sessions/**`). Reading mechanisms were verified per source in 2026-10 (task `10-10-external-session-knowledge`); one mechanism per source, documented in each adapter's header comment.
- **Project identity**: from recorded cwd inside the records, never from the (non-reversible) directory slug.
- **Dedup / correlation**: source-specific (Codex: projection from `response_item` only; Claude: tool_use id ↔ tool_result `tool_use_id`; pi: `toolCallId`). Torn trailing JSONL line → skip + warning, preceding records stay valid.
- **Branches**: pi projects the id/parentId tree (branches = leaves, identity = tip record id, label = first user message after the fork); Codex/Claude report `LINEAR_BRANCH`. Switching branch = re-read with explicit branchId; a vanished branch throws, never silently retargets.
- **Unknown vs known-undisplayable records**: known-and-expected non-displayable record types (Codex encrypted `reasoning` / `web_search_call` / `local_shell_call` payloads; Claude non-conversation bookkeeping like `attachment`, `system`, `cost-state`, `file-history-*`; pi `compaction` / `model_change` / `custom` entries) are excluded from the display projection AND from warnings — they appear in every real session and are not drift. Genuinely unknown record types (adapter does not recognize the type at all) are counted in `warnings`, never fatal — that is real format-drift signal. Unsupported format version → explicit error state, no migration.

### 4. Validation & Error Matrix

- unreadable/torn source file → per-file warning, other files listed
- one source root unreadable → one aggregated error line, other sources listed
- unknown record type → warning, not a crash (known-undisplayable types → silent skip, no warning)
- unsupported format version → explicit error, no migration attempted

### 5. Good/Base/Bad Cases

- Good: adapter port has only read operations; unknown types degrade to warnings
- Base: missing source root = empty source (not an error)
- Bad: decoding the dir slug for project identity; using the tool's own API that resumes/migrates sessions; merging duplicate physical copies silently

### 6. Tests Required

Synthetic fixtures only — **never commit personal transcripts**. Cover: cross-project discovery, duplicate events, tool correlation, images, torn trailing line, per-source isolation (both directions), branch projection/switching.

### 7. Wrong vs Correct

```ts
// Wrong: project from directory name (slug is not reversible)
const project = decodeSlug(path.dirname(filePath));
// Correct: from the record's own cwd field
const project = record.cwd;
```

---

## Scenario: Save a Capture (verbatim or AI note)

### 2. Signatures

```ts
// captureService.ts
interface SaveCaptureInput {
  detail: ExternalSessionDetail;         // immutable snapshot — never re-read mid-flow
  selectedMessages: string[];            // message ids
  textRanges?: TextRangeSelection[];     // { messageId, start, end } half-open over content
  noteBody?: string;                     // AI-note flow: user-EDITED draft, not raw generation
}
```

### 3. Contracts

- **Evidence-before-note**: write order is assets → `records.json` → note. A failed evidence write must not publish a note with broken companion links.
- **Vault-bound-at-confirm**: the write port binds to the vault manager captured when the user confirms — an async vault switch cannot retarget the write.
- **Completeness is selection-scoped**: `missing` counts only the selection's missing items. Session-level warnings (e.g. Codex encrypted `reasoning` records, a torn tail from a file still being written) are recorded but must NOT mark the capture incomplete.
- **Text ranges**: selecting text authorizes only that excerpt. Ranged messages keep `rawRecord: []`; evidence stores excerpt + `[start, end)` coordinates over canonical text (`ExternalSessionMessage.content`). Whole-message selection supersedes a range on the same message.
- **Staleness**: at confirm, `verifySelectionFresh()` compares the snapshot against a fresh re-read; changed/null source → `StaleSelectionError`, nothing written, user reselects.
- **No silent overwrite**: existing note path → `CaptureConflictError`.
- **Locator block**: note footer carries a fenced ```folyn-session``` block (`folyn-session-locator/1` format, `sourceLocator.ts`) — parse is strict (marker-less prose rejected). Navigation: copy block → detail-view header 打开来源 → match by source+sessionId; missing source → open the saved evidence instead, never claim the live record matches.

### 4. Validation & Error Matrix

- stale selection → `StaleSelectionError`, no writes
- evidence write failure → note not published, error surfaced
- existing note path → `CaptureConflictError`
- no active vault → explicit no-vault state, nothing written

### 5. Good/Base/Bad Cases

- Good: source deleted after save → note + bundle + assets still readable via vault-relative links (survive vault moves)
- Base: missing attachment → honest missing list before save and in the saved record; remaining content saves
- Bad: labeling incomplete captures complete; AI-reconstructing missing text; truncating oversized AI input silently

### 6. Tests Required

Capture service tests with a test vault provider: write order, byte-identical assets, source-deletion survival, conflict, staleness, vault switching mid-flow.

### 7. Wrong vs Correct

```ts
// Wrong: capture completeness from session-wide anomalies
const complete = missing.length === 0 && sessionWarnings.length === 0;
// Correct: only what the selection actually failed to obtain
const complete = missing.length === 0;
```

---

## Scenario: AI-Organized Note Generation

- Reuse the `runRigChat` seam only (`historyMode: 'none'`, fresh `session-note:<id>` sessionId, preamble) — no new model path. Model-stub tests must **inspect the stub's input** and prove: unselected content absent, ranged messages contribute only excerpts, sibling branches absent, no prior history.
- Failure states are explicit: no-model, generating+cancellable, too-large (honest char limit, never truncate), unsupported-image (explicit text-only opt-in, choice never persists across generations), insufficient-context, error+retry. Nothing is written before user confirm.
- Cancel captures the per-request cancel flag object at request start — reading a ref live lets a retry silently un-cancel the still-running old request.

---

## Conventions & Gotchas

- **i18n**: all `sessions` namespace keys must exist in all 6 locales (zh/en/ja/es/de/fr) with identical key trees — `extracted-namespaces.test.ts` guards parity. Shared chat components must not hardcode Chinese strings (they render in the pet window and AI panel too).
- **Test runner gotcha**: run vitest **from the repo root** (`npx vitest run --project desktop …`). Running inside `apps/desktop` bypasses `vitest.workspace.ts` aliases/setup and fails with `getFileTypeIcon is not a function` and JSON import-attribute errors.
- **Real-model behavior is stub-verified only** (no paid calls in tests); real `~/.codex`/`~/.claude`/`~/.pi` end-to-end is manual acceptance.
