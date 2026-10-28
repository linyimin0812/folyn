# Knowledge Base (`__kb__/`) Contracts

> Code-spec for the per-vault knowledge base (`apps/desktop/src/services/knowledge/`). Requirements live in `docs/design/pageindex-knowledge-base.md` + ADR 0005–0011; this file records the executable contracts only.

---

## Scenario: knowledge base slice A (ingest / synthesis / retrieval)

### 1. Scope / Trigger

- Trigger: knowledge-base data format (`~/.folyn/vaults/<vaultId>/__kb__/`, ADR-0011) + a model-bridge contract + program-enforced retrieval budget. Any future change to these files is a cross-layer contract change.

### 2. Signatures

- **Review apply** (`kbReviewActions.ts`): `applyReview` re-checks the topic page's hash vs `KbReviewItem.topicHash` (mismatch → `stale`, page is NOT written), merges the proposed body, and **renumbers `[^cN]` markers in a single pass with an id map** — sequential `split().join()` renames collide when a new id falls inside a renamed range and collapse distinct citations onto one id. `discardReview` keeps the page text as-is. Both remove the review entry.
- **Stop tracking**: `stopTracking` removes the path from scope and sets `KbSourceEntry.removed` in the manifest. `knowledgeBuild` skips `removed` sources (no re-ingest); explicitly re-adding the path to scope rebuilds the entry without `removed`. Removed sources stay out of the BM25 index; retrieval marks their evidence "来源已移除（已停止跟踪）" but the cited-version snapshot stays readable (ADR-0007).
- **Cancellation** (`retrievalLoop.ts`): `shouldCancel` is checked at round boundaries only (an in-flight model call cannot be aborted — documented ceiling); cancelled loops return the evidence accumulated so far, and `kbAsk` skips the answer layer on cancel. Stopping retrieval must never discard found evidence.
- Model bridge (`kbLlm.ts`): `kbChatText(prompt, preamble)` → single string. Built on `runRigChat` with **`historyMode: 'none'`** (each call independent — chat history must never pollute structured calls) + feature `preamble`. Knowledge JSON calls use a local quote/escape-aware balanced-container parser (valid JSON fences allowed); ambiguous multiple objects, root arrays and truncated outer containers are rejected. A textual format failure allows only **one** extra independent request using the original prompt plus a stricter JSON reminder and the same resolved model pair. Provider/network errors are never format-retried. Empty text, thinking-only output, and absent completion events have distinct errors; reasoning is never parsed as knowledge data. No fabricated syntax/data repair or raw prompt/output logging.
- Model pair: `resolveKbChatPair()` prefers `aiConfigStore.kbPair` (per-caller `ProviderModelPair | null`, same pattern as `voicePair`/`extensionPair`); **null falls back to the global chat pair** (deliberate — explicit selection overrides, unset follows global). API keys never enter vault files; they resolve via `resolvePairConfig` from per-provider settings only.
- Ingest (`sourceIngest.ts`): `ingestSource(...)` → `{ index, srcId }`; `validateIndexNodes(nodes, lineCount)` → narrowed nodes (out-of-range / overlapping nodes are dropped, not fatal).
- Synthesis (`topicSynth.ts`): model proposals are narrowed by `validateClaims` before any write; auto-write only for new pages and new-section appends.
- Retrieval (`retrievalLoop.ts`): `runRetrievalLoop(...)` executes model-issued JSON actions (`list_topics` / `open_topic` / `search` / `read_source` / `done`) and returns structured evidence only. The final answer is a **separate** `kbChatText` call (retrieval and answering are evaluated independently, ADR-0008).

### 3. Contracts

Disk layout under `~/.folyn/vaults/<vaultId>/__kb__/themes/<themeId>/` (files are the source of truth — storage lives in the app-config dir, NOT inside the vault, ADR-0009/0011). Root `__kb__/themes.json` stores `{ themes: [{ id, name }], activeThemeId }`; **sources** stay vault-relative and are read through `vaultStore.manager`. There is no legacy root-manifest fallback and no migration of old `<vault>/__kb__` data (ADR-0011 — new location starts empty; the old directory is left for the user).

**Dual routing (`vaultKbFs`, ADR-0011):** path derivation stays logical/synchronous (`__kb__/...` from `kbPaths.ts`, `fs.root` stays a relative `__kb__/themes/<id>` prefix); the adapter routes by prefix — `isKbPath(p)` resolves to an absolute path under `~/.folyn/vaults/<vaultId>/` (module-cached `homeDir` base, versionHistory pattern) and goes through the `KbGenStore` tauri-fs backend (write = parent `mkdir -p` + `writeTextFile`); everything else goes to `vaultStore.manager`. The vault-switch guard covers both routes and keeps the original sync-throw semantics on `readFile`/`writeFile`/`rename`. `fs.absPath(p)` resolves KB-generated paths for editor opens (external absolute path, drops precedent) and returns `null` for source paths. `listSourceTree` still scans the vault via manager (old `<vault>/__kb__` dirs stay excluded). Cross-route rename (generated ↔ source) is rejected explicitly.

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
- Rebuildable BM25 index: in-memory per Vault + theme identity (disk cache under `~/.folyn/vaults/<id>/kb-cache/` deferred until the 10 s budget fails at 1,000-doc acceptance).
- Scope expansion (`knowledgeBuild.expandScope`) must exclude `__kb__/` (both in TS `isKbPath` and the Rust `scan_file_tree` exclude list).

### 4. Validation & Error Matrix

| Condition | Behavior |
| --- | --- |
| Model JSON unparseable (2 consecutive) | Retrieval loop terminates with evidence so far |
| Claim's srcId unknown / versionHash mismatch / line range outside real file | Claim discarded + `console.warn`; never written |
| Target topic page current hash ≠ `lastProgramHash` (user edited) | Change downgraded to `reviews.json`; page never overwritten (ADR-0006) |
| `read_source` with non-positive / inverted / non-integer ranges | Rejected at parse (loop) / clamped to 100-line window (reader) |
| Wall clock ≥ 10 s or 8 turns or 4,000 chars/turn | Loop stops, returns evidence + unresolved gaps |
| Store `build` failure | Caught → `buildError` state surfaced in panel (no unhandled rejection) |
| Store `saveConfig` failure | Returns `{ ok: false, error }`; form keeps drafts open and does not start processing |

### 5. Good/Base/Bad Cases

- Good: ingest 3 notes → indices + 2 topic pages, citations verify, snapshot files exist for cited hashes only.
- Base: 0 sources in scope → empty manifest, panel asks to pick scope; no error.
- Bad: model proposes `endLine: 99999` → claim dropped with warn, page written without it (never a fatal ingest failure).

### 6. Tests Required

`apps/desktop/src/services/knowledge/*.test.ts` (run from repo root: `pnpm exec vitest run apps/desktop/src/services/knowledge`):

- `kbLlm.responses.test.ts` — actual bridge seam: valid one-call response, bounded format recovery, provider error propagation, empty/thinking/missing completion diagnostics, fences/quoted braces/arrays/truncation/ambiguity.
- `knowledgeBuild.phase.test.ts` — per-source failures retain indexing vs topic-synthesis phase in visible message.
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

- **Duplicate corroboration** (`topicSynth.ts`): a proposed claim that normalized-matches an existing ref's `claimText` (fallback `anchorText`; same whitespace-stripped containment match as deletion intents) supplements the citation **without new body text**: `supplementRefsToPage` inserts `[^cM]` (smallest unused id) after the existing marker, appends the ref + footnote def, merges frontmatter sources. Misses fall through to append/review — never auto-merge on paraphrase. User-edited page → downgrade to a `reason: 'add-ref'` review; applying it re-finds the target on the current page and fails stale if the claim or marker is gone. Partition order in `applyProposal`: deletion intents first (cannot be bypassed by corroboration) → restore suggestions → dup-supplement / new append.
- **Incremental updates** (slice B): `fileWatcher.subscribeVaultChanges` (non-editor subscribers see post-pause/suppress filtered paths) → `kbAutoBuild` (1.5 s debounce, `isKbPath` + extension + scope filter, drops events while building, `kbAutoBuild` toggle in aiConfigStore) → `buildKnowledge(only: [path])`. Move/rename: `kbMoveReconcile` matches a vanished manifest path's content hash against unclaimed scope files → path-only manifest update (srcId/refs untouched); hash mismatch = delete + new. Citation panel shows three-way version state (cited / ingested / on-disk) via `citationVersionWarn`, same semantics as `kbAsk.readSource`.
- **Edit intents** (`kbIntentWatch.ts`): user edits to `__kb__/themes/<themeId>/topics/*.md` reconcile against `lastProgramHash` — footnote gone AND anchor text gone → deletion intent in `deletions.json` + ref `deleted`; paragraph text no longer matches `claimText` → ref `unverified`. The user's hash becomes the new program baseline (their edit is never overwritten). Runs only while the knowledge panel is mounted; re-checks `buildRunning` at debounce fire. ADR-0011 ceiling: topic pages now live outside the vault, so the vault watcher no longer emits their events — the subscription wiring is retained (harmless), and `suppressWatcherFor` on KB paths is a no-op kept for defense.
- **Verification** (`kbVerify.ts`): `unverified → verified | unsupported` is one-way; the check reads the cited version's snapshot lines (hash-verified fallback to live content only when it still matches `versionHash` — drifted content fails honestly). Unsupported → amber notice, body kept; rewrite still requires review.
- **Review reasons**: `user-edited` (append downgraded), `restore-suggestion` (claim matches an active deletion intent; apply = write back + release that intent, discard = keep the intent), `add-ref` (corroboration downgraded; body stays read-only, no `editedBody`). `applyReview` writes cited-version snapshots per ref after refs land (only when the source's current content hash matches the ref's `versionHash`).

---

**Related**: [State Management](./state-management.md) (knowledgeStore, no persistence — hydrates from manifest), [Directory Structure](./directory-structure.md), [Feature Agents](./feature-agents.md) (NOT used here — the knowledge base runs model calls through `runRigChat`, no CLI sidecar agent).

## Parallel build contracts (2026-10-28)

- **Two-level parallelism**: `buildKnowledge` runs sources through a worker pool (`SOURCE_CONCURRENCY = 3`; cancel is checked at task boundaries); per-source chunk loops (ingest and synthesis) use `mapWithConcurrency` with `KB_CHUNK_CONCURRENCY = 3` — results keep chunk order, so parallelism never changes merge order or validation semantics. All model calls share a global in-flight gate `KB_MAX_CONCURRENT_LLM_CALLS = 6` inside `collectResponse` (FIFO waiters, released in `finally`; the format-retry second call passes the gate again and counts as in-flight).
- **KB write serialization**: every build-path cross-file read-modify-write section goes through `kbWriteQueue` (promise-chain mutex in `kbFs.ts`): `appendReviews`, the whole of `topicSynth.applyProposal` (read page/refs/deletions → compute → write), and the per-item publish (`writeManifest` + `writeNavigation` as one pair). Per-source exclusive writes (`writeSourceIndex`, cited-version snapshot) stay outside the queue — one worker owns one srcId and `kbWriteAtomic` tmp names are per-target-path. **A `kbWriteQueue` section must never call `kbWriteQueue` again** (the chain would wait on itself — deadlock). Non-build writes (saveConfig / review apply / verify / in-page edit) stay unqueued and rely on the store's `mutationRunning` vs `buildRunning` mutex.
- **Parallel snapshot compensation**: `synthTopicsForSource` takes the `existingTopics` snapshot once, before the parallel chunk calls; at apply time the title lookup is mode-independent — a `'new'` proposal whose title matches an existing topic routes through the append path. Same-name proposals from concurrent sources merge into one page (shared manifest object, mutated synchronously inside the queue), and a user-edited page still downgrades to `reviews.json` instead of being appended (ADR-0006 unaffected).
- **Cancellation**: a mid-chunk cancel throws the `KbBuildCancelled` sentinel; `buildKnowledge` resets the item to `pending` (never `error`, never published — no half state in manifest/sources) and published items are retained. In-flight model calls cannot be aborted (documented ceiling).
- **Progress callbacks**: `BuildOptions.onDetail/onStream` carry the source `path` (no single "current item" under parallelism — `knowledgeStore` keys `buildDetails` by path); `onProgress`'s second argument is the completed count (done/skipped/error), stored as `buildCurrentIndex` — UI progress text derives from `buildItems` statuses ("已处理 N / M 份资料").

## Workbench UI contracts

- `KnowledgeWorkbench` owns the flex height chain (`flex-1 min-h-0` on both the shell and page host). Each page owns its scrolling; a child with `flex-1` inside a non-flex host does not fill the work area.
- Knowledge layout responds to the **allocated workbench width** with container queries: source evidence is adjacent at 900px+, below the document otherwise. Do not use viewport breakpoints: the app sidebar and auxiliary panes consume space.
- `TopicReader` keys file reads by page id/path/data version; runtime scroll and selected-citation caches include Vault + configured theme + page. Loading, error and ready are distinct states; late requests cannot display another theme/page's content. Citation/snapshot identities reset their excerpt state before reading a new source.
- In-page editing (10-28): 「编辑知识页」 toggles the app's real `FolynEditor` (CodeMirror markdown, `persistTabScroll={false}` — it lives outside the files-tab system) holding the raw file (frontmatter + body + footnote defs) — never the display body, which strips the H1 and citationizes `[^cN]`. Save goes through `saveTopicPage(tpId, content)` (capture → mutation guard → `kbWriteAtomic` + `suppressWatcherFor` (no-op for KB paths since ADR-0011, kept defensively) → `invalidateKbIndexCache` → hydrate). It is a **user edit**: `lastProgramHash` stays untouched so ADR-0006 user-edited degradation keeps working. Failure keeps the editor open with the error; cancel discards. Entering edit closes the citation panel (its scroll-position save path has no live reading scroller). Tests must mock `@/store/vaultStore` and `@/editor/EditorView` — the real module chains reach the file-types registry (excalidraw → open-color JSON) and CodeMirror, and fail to collect under Node ESM.
- Editor opens of KB-generated files (citation snapshots via the citation panel) must pass the **absolute** path resolved by `fs.absPath` (external-file route, drops precedent) — the vault-relative string no longer locates the file. Source paths keep opening vault-relative.
- The document header supplies the topic title. A matching leading Markdown H1 is omitted for display only; unrelated headings and the stored file remain unchanged. Topic overview metadata comes from navigation/reviews, not internal `__kb__/topics/` paths.
- Answers reuse `renderMarkdownToReact`; `.kb-md` restores ordered/unordered list markers removed by Tailwind preflight. Keyboard Enter submission excludes IME composition and preserves Shift+Enter newlines.
- Regression coverage: `components/knowledge/TopicReader.test.tsx` (late responses, missing-file retry, snapshot switch, duplicate heading, overview selection, inline edit save/fail/cancel) and `AskView.test.tsx` (Markdown rendering, IME/multiline, running cancellation).

### Source intake transactions

- `openSourceSettings('add' | 'settings')` enters the sources page and opens the requested editor directly. `sourceEntry` is runtime UI state, not vault metadata.
- `saveConfig({ goal, scope }): Promise<{ ok: true } | { ok: false; error: string }>` writes the manifest before publishing goal/scope to the runtime store. Every filesystem operation, including the atomic temporary-write/rename sequence, checks the originating vault id. A late result after vault switching must not publish another vault's settings.
- Setup and Sources keep goal/scope/model/automatic-processing as local drafts. Cancel leaves committed configuration intact; only successful save commits preferences. **Wrong:** update `goal` first (unmounts setup), catch errors, then start build unconditionally. **Correct:** await `saveConfig`; on failure keep the form; on success apply preferences and build only for the explicitly chosen organize action.
- Disable/guard all controls during save. A disabled fieldset does not disable custom `div` toggles; their callbacks need a saving guard. Model selection callbacks need the same guard for an already-open picker.
- `ScopePicker` searches names/paths, reflects directory inheritance explicitly, and leaves unsupported children unchecked. Preview/count/organize availability account for stopped sources using the same explicit-path re-inclusion rule as `buildKnowledge`.
- Completion shows actual processed/skipped/failed/unfinished counts and **associated** topic links; current build progress does not identify exactly which topic pages changed. Source-specific review counts derive from `review.refs[].srcId`; the link opens the real review page and does not imply a pre-filtered list.
- Automatic processing currently watches only while KnowledgePanel is mounted; copy must say so. Stop is cooperative at source boundaries and must show the pending stop request.
- `SourcesView.test.tsx` verifies draft cancellation, direct entry, save-only vs organize, first-use and normal save failures, inherited/unsupported selection, stopped-source exclusions, source review links, pending-save custom controls, and stale-vault read/rename protection.


## Independent configured themes (ADR-0010)

- A user-configured theme owns its name, goal, source selection and generated knowledge pages. UI labels must distinguish “主题” from generated “知识页”; model-proposed content groupings are not user-configured themes.
- Production filesystem operations capture a fixed Vault and theme root. Path helpers receive `fs.root`; source paths remain Vault-relative. Never use a mutable module-global active path prefix: switching the UI during an awaited model request would redirect its writes.
- `themes: { id, name }[]`, `activeThemeId: string | null` expose the registry; existing goal/scope/topics/reviews/ask fields project the selected theme.
- `createTheme({ name, goal, scope })` and `saveConfig({ goal, scope, name? })` return an explicit success/error result. Creation errors keep the user's draft; no processing starts after a failed save.
- `selectTheme(id)` persists selection and loads that theme. Delayed operations are bound to their origin, and must not publish old results to the newly selected theme. Registry updates are serialized per Vault to prevent lost creation/rename/selection writes.
- `activeThemeFs()` supplies a captured context to readers. Citation snapshot paths must use the same root, including “open in editor” actions. Cache identity includes both Vault and theme.
- Required regressions: two themes using the same source do not share generated files/reviews/results; selection survives rehydration; switch during delayed generation/ask cannot contaminate the next theme; debounce timers cannot process old events as the new theme; malformed registry is reported rather than overwritten as an empty library.

### Theme workspace UI state

- `KnowledgeWorkbench` keeps its local page slots mounted while changing knowledge/ask/sources/reviews. Source/configuration drafts and review proposals are cached by Vault + theme; reader scroll and selected citation additionally include knowledge-page id. Never key these caches by page path alone across Vaults.
- `ThemeDialog` uses a native modal dialog for focus containment/Escape behavior. A dedicated flex scroll wrapper contains its fieldset; fixed header/footer remain accessible when the file picker expands. Fieldset alone is not a reliable flex scroll container in browsers.
- Source intake inside the workspace relies on the shared header primary action; do not duplicate configuration summaries and organize controls within the embedded page.
- Per-theme mutation guards serialize configuration/review/verification/intents against generation. Disabled UI controls alone cannot prevent asynchronous read-modify-write conflicts.

### Model selection entry (2026-10-28)

- `KnowledgeModelSelector` wraps the real `PairSelector`, labels its purpose, anchors the dropdown left, and routes an empty enabled-model list to `navStore` models settings.
- The workbench shows this control when source forms are closed; its selection updates global `kbPair` directly. Add/settings forms use local pair drafts and publish only after successful configuration save. Cancel/failed save must not mutate the committed pair.
- Do not replace PairSelector with a null stub in source workflow regression tests: it masks missing provider options and missing settings routes. Exercise enabled pairs and an empty list.

### Density and file-browser consistency (2026-10-28)

- ScopePicker reuses `FileIcon`, never generic replacement glyphs or a copied extension map. Match FileTreeItem: 16px icon, 16px depth step, 12px base inset, 5px gap, square rows, act/hov colors and UI-font-size minus 2px.
- Row vertical padding is `.25rem` to match sidebar `py-1`; do not substitute 4px because root font sizing changes the actual rem. Metadata aligns center and inherits line-height so it does not increase row height. Coarse pointer targets retain 40px.
- Compact knowledge chrome and list spacing before reducing body text: reading remains 15px with 1.75 line-height. Preserve readable line lengths and accessible checkbox/focus behavior.

- In ScopePicker, directory names are separate native buttons with `aria-expanded`; clicking them toggles descendant visibility without changing scope. Only the checkbox changes directory selection. Search reveals matching descendants even when their directory was collapsed; clearing search restores the previous expansion state. Inherited folders remain expandable even when their checkbox is disabled.

- The theme switcher uses a custom combobox/listbox, with active option indication, Arrow/Home/End navigation, Enter/Space selection, Escape and outside-click dismissal. Keep focus on the trigger and scroll the highlighted option into view.
