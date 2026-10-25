# Knowledge Base (`__kb__/`) Contracts

> Code-spec for the per-vault knowledge base (`apps/desktop/src/services/knowledge/`). Requirements live in `docs/design/pageindex-knowledge-base.md` + ADR 0005–0009; this file records the executable contracts only.

---

## Scenario: knowledge base slice A (ingest / synthesis / retrieval)

### 1. Scope / Trigger

- Trigger: new on-disk vault data format (`<vault>/__kb__/`) + a model-bridge contract + program-enforced retrieval budget. Any future change to these files is a cross-layer contract change.

### 2. Signatures

- **Review apply** (`kbReviewActions.ts`): `applyReview` re-checks the topic page's hash vs `KbReviewItem.topicHash` (mismatch → `stale`, page is NOT written), merges the proposed body, and **renumbers `[^cN]` markers in a single pass with an id map** — sequential `split().join()` renames collide when a new id falls inside a renamed range and collapse distinct citations onto one id. `discardReview` keeps the page text as-is. Both remove the review entry.
- **Stop tracking**: `stopTracking` removes the path from scope and sets `KbSourceEntry.removed` in the manifest. `knowledgeBuild` skips `removed` sources (no re-ingest); explicitly re-adding the path to scope rebuilds the entry without `removed`. Removed sources stay out of the BM25 index; retrieval marks their evidence "来源已移除（已停止跟踪）" but the cited-version snapshot stays readable (ADR-0007).
- **Cancellation** (`retrievalLoop.ts`): `shouldCancel` is checked at round boundaries only (an in-flight model call cannot be aborted — documented ceiling); cancelled loops return the evidence accumulated so far, and `kbAsk` skips the answer layer on cancel. Stopping retrieval must never discard found evidence.
- Model bridge (`kbLlm.ts`): `kbChatText(prompt, preamble)` → single string. Built on `runRigChat` with **`historyMode: 'none'`** (each call independent — chat history must never pollute structured calls) + feature `preamble`. JSON extracted with `extractJsonObject`.
- Model pair: `resolveKbChatPair()` prefers `aiConfigStore.kbPair` (per-caller `ProviderModelPair | null`, same pattern as `voicePair`/`extensionPair`); **null falls back to the global chat pair** (deliberate — explicit selection overrides, unset follows global). API keys never enter vault files; they resolve via `resolvePairConfig` from per-provider settings only.
- Ingest (`sourceIngest.ts`): `ingestSource(...)` → `{ index, srcId }`; `validateIndexNodes(nodes, lineCount)` → narrowed nodes (out-of-range / overlapping nodes are dropped, not fatal).
- Synthesis (`topicSynth.ts`): model proposals are narrowed by `validateClaims` before any write; auto-write only for new pages and new-section appends.
- Retrieval (`retrievalLoop.ts`): `runRetrievalLoop(...)` executes model-issued JSON actions (`list_topics` / `open_topic` / `search` / `read_source` / `done`) and returns structured evidence only. The final answer is a **separate** `kbChatText` call (retrieval and answering are evaluated independently, ADR-0008).

### 3. Contracts

Disk layout under `<vault>/__kb__/` (files are the source of truth and travel with the vault, ADR-0009):

```
manifest.json              # { goal, sources: {srcId -> {path, currentHash, ...}}, topics: {tpId -> {path, title}} }
sources/<srcId>.index.json # structure index: nodes [{title, summary, startLine, endLine}]
sources/<srcId>/<hash>.md  # cited-version snapshot — written ONLY when a citation referencing that hash lands (see §7)
topics/<tpId>.md           # topic page: frontmatter {id, title, sources} + body with [^cN] footnote citations
topics/<tpId>.refs.json    # [{id, anchorText, srcId, versionHash, startLine, endLine, status}]
navigation.json            # topic → related topics + sources
reviews.json / deletions.json  # schemas seeded in slice A, UI later
```

- Line numbers are **1-based, end-inclusive** everywhere: index validation, anchor-text check (`lines.slice(start-1, end)`), and retrieval reads must agree.
- Stable ids (`src-*` / `tp-*` from `generateShortId`) live in `manifest.json`; paths record only current location.
- Rebuildable BM25 index: in-memory per vaultId (disk cache under `~/.folyn/vaults/<id>/kb-cache/` deferred until the 10 s budget fails at 1,000-doc acceptance).
- Scope expansion (`knowledgeBuild.expandScope`) must exclude `__kb__/` (both in TS `isKbPath` and the Rust `scan_file_tree` exclude list).

### 4. Validation & Error Matrix

| Condition | Behavior |
| --- | --- |
| Model JSON unparseable (2 consecutive) | Retrieval loop terminates with evidence so far |
| Claim's srcId unknown / versionHash mismatch / line range outside real file | Claim discarded + `console.warn`; never written |
| Target topic page current hash ≠ `lastProgramHash` (user edited) | Change downgraded to `reviews.json`; page never overwritten (ADR-0006) |
| `read_source` with non-positive / inverted / non-integer ranges | Rejected at parse (loop) / clamped to 100-line window (reader) |
| Wall clock ≥ 10 s or 8 turns or 4,000 chars/turn | Loop stops, returns evidence + unresolved gaps |
| Store `build` / `saveConfig` failure | Caught → `buildError` state surfaced in panel (no unhandled rejection) |

### 5. Good/Base/Bad Cases

- Good: ingest 3 notes → indices + 2 topic pages, citations verify, snapshot files exist for cited hashes only.
- Base: 0 sources in scope → empty manifest, panel asks to pick scope; no error.
- Bad: model proposes `endLine: 99999` → claim dropped with warn, page written without it (never a fatal ingest failure).

### 6. Tests Required

`apps/desktop/src/services/knowledge/*.test.ts` (run from repo root: `pnpm exec vitest run apps/desktop/src/services/knowledge`):

- `sourceIngest.test.ts` — line-range validation, lossless chunking.
- `topicSynth.test.ts` — claim narrowing, page/refs assembly, **snapshot exists only when citations land** (ADR-0007 regression), user-edited page → review downgrade.
- `retrievalLoop.test.ts` — done path, turn/wall-clock/parse-failure termination, per-turn read cap.
- `bm25Index.test.ts` — English tokens + CJK bigrams, title boost.

### 7. Wrong vs Correct

#### Wrong

```ts
// Writing a version snapshot at ingest time — retains never-cited versions,
// violating ADR-0007 (retain latest + all *cited* versions only).
await fs.writeFile(snapshotPath(srcId, hash), content); // in ingestSource
```

#### Correct

```ts
// Snapshot only after refs for that version actually land on disk.
if (applied > 0) {
  await fs.writeFile(snapshotPath(srcId, versionHash), content); // in synthTopicsForSource
}
```

---

**Related**: [State Management](./state-management.md) (knowledgeStore, no persistence — hydrates from manifest), [Directory Structure](./directory-structure.md), [Feature Agents](./feature-agents.md) (NOT used here — the knowledge base runs model calls through `runRigChat`, no CLI sidecar agent).
