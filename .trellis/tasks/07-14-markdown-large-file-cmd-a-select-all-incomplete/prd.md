# Markdown large file Cmd+A select all incomplete

## Goal

When editing a large Markdown file in the CodeMirror-based editor (`apps/desktop/src/editor/EditorView.tsx`), Cmd+A (select all) does not select the entire document. Fix the root cause so that Cmd+A reliably selects the full doc regardless of file size, and Cmd+C immediately after yields the complete content.

## What I already know

* Editor is CodeMirror 6 (`@codemirror/commands` 6.10.3, `@codemirror/view` 6.41.0).
* Keymap at `apps/desktop/src/editor/EditorView.tsx:258-267`:
  ```js
  keymap.of([
    { key: 'Mod-a', run: selectAll },
    ...closeBracketsKeymap,
    ...defaultKeymap,   // also contains Mod-a: selectAll — first match wins
    ...searchKeymap, ...historyKeymap, ...completionKeymap, ...lintKeymap,
    indentWithTab,
  ])
  ```
* Verified `@codemirror/commands@6.10.3` `selectAll` source (`node_modules/.../commands/dist/index.js:1053`):
  ```js
  const selectAll = ({ state, dispatch }) => {
      dispatch(state.update({ selection: { anchor: 0, head: state.doc.length }, userEvent: "select" }));
      return true;
  };
  ```
  No early-return, no conditionals — always selects `0..state.doc.length`.
* Verified CM6 copy handler (`node_modules/.../view/dist/index.js:5128`): `handlers.copy` reads `state.selection.ranges`, slices doc via `state.sliceDoc(range.from, range.to)`, and calls `event.clipboardData.setData("text/plain", text)`. `brokenClipboardAPI` is only true for old IE/iOS — not macOS Tauri (WebKit).
* Extensions layered on top for markdown: `slashCommandExtension`, `codeBlockExtension` (uses `Prec.highest` but only binds `Escape`/`Enter`), `orderedListExtension`, `inlineDiffExtension`, `EditorView.lineWrapping`, paste-only DOM handler.
* None of these extensions use `appendTransaction`, `filterTransaction`, `selectionFilter`, or bind `Mod-a` (verified via grep).
* No global window-level `Cmd+A` handler (`App.tsx:598` keydown only handles `s`, `shift+f`, `d`, `p`).
* Content loading: `editorStore.openFile` reads via `useVaultStore.getState().readFile` → `tauriProvider.readFile` → `@tauri-apps/plugin-fs` `readTextFile` (full file read, no truncation in code path).
* `externalContentVersion` bump triggers `replaceContent(activeTab.content)` — if this fires spuriously during Cmd+A it could overwrite the doc with stale/truncated content. Worth ruling out.

## Symptom (confirmed by user)

* File size: a few hundred to a few thousand lines is enough to trigger — not a "huge file" issue.
* Cmd+A selects to a point and stops (visual highlight terminates mid-document).
* Cmd+C immediately after → pasted content is incomplete (matches the visual cutoff).
* Therefore: the selection range itself is truncated, NOT just a visual rendering bug.

The "few hundred to few thousand lines" finding rules out:
* WebKit clipboard truncation (limit is well above this)
* Doc length limits in CM6 (handles millions of chars)
* File read truncation (Tauri readTextFile reads full file)

## Hypothesis (ranked)

1. **Spurious `replaceContent` / external content sync** — A re-render during Cmd+A dispatches a `replaceContent(activeTab.content)` call where `activeTab.content` is stale or truncated. This would replace the doc mid-keystroke, after which the selection points beyond the new (shorter) doc and gets clamped. Most consistent with "selects to a point and stops".
2. **CM6 `selectAll` dispatch is being intercepted** — Some extension's `appendTransaction` modifies the selection after dispatch. (Grep ruled this out for the existing extensions, but worth re-verifying at runtime.)
3. **WebKit clipboard truncation** — Tauri's clipboard-manager plugin (uses `arboard`) intercepts `setData` and truncates large strings. (Less likely: `arboard` on macOS uses NSPasteboard which has no size limit.)

## Diagnostic step (mandatory before fix)

Add a temporary debug log to `apps/desktop/src/editor/EditorView.tsx` keymap entry:

```js
{
  key: 'Mod-a',
  run: (view) => {
    const before = view.state.doc.length;
    const selBefore = view.state.selection.main;
    const result = selectAll(view);
    const after = view.state.doc.length;
    const selAfter = view.state.selection.main;
    console.log('[Cmd+A]', { before, after, selBefore, selAfter, contentChanged: before !== after });
    return result;
  },
}
```

User reproduces in a large markdown file, runs once, reports console output. Three possible outcomes:

* `before !== after` (doc length changed) → Hypothesis 1 (spurious replaceContent). Root cause is in the React/Trellis state sync, not in the editor. Fix path: guard `replaceContent` against stale or equal-content dispatches; or identify what bumps `externalContentVersion` during Cmd+A.
* `before === after` but `selAfter.to !== after` → Hypothesis 2 (interception). Add a `Transaction.filter` trace.
* `before === after` and `selAfter.to === after` but Cmd+C still incomplete → Hypothesis 3 (clipboard). Switch to `tauri-plugin-clipboard-manager` `writeText` in a custom copy handler.

## Open Questions

* Repro details: what's the approximate file size (lines / KB) where this happens? (Helps build a synthetic test.)
* Does the cutoff point correlate with a specific content feature (code block, image, heading, frontmatter) or character count?

**Answered**: 几百上千行就出问题 — rules out size-limit causes. Cutoff point not yet characterized; will be revealed by diagnostic log.

## Requirements (final)

* Cmd+A in a Markdown file of any size (verified at hundreds-to-thousands of lines) selects the entire document content from 0 to `doc.length`.
* Cmd+C immediately after Cmd+A yields the complete document content on paste.
* No spurious content truncation during the Cmd+A → Cmd+C flow.

## Acceptance Criteria

* [ ] Diagnostic log shows whether `doc.length` changes during Cmd+A (rules in/out Hypothesis 1).
* [ ] Diagnostic log shows whether `selection.main.to === doc.length` after Cmd+A (rules in/out Hypothesis 2).
* [ ] Diagnostic log shows whether the copied text length === `doc.length` (rules in/out Hypothesis 3).
* [ ] Root cause fixed at the shared path (not a per-symptom patch).
* [ ] Diagnostic log removed before commit.
* [ ] Lint / typecheck green.

## Decision (ADR-lite)

**Context**: Cmd+A truncates the selection in large markdown files. Static analysis shows `selectAll` always selects `0..doc.length` and no extension intercepts selection, so the bug only manifests at runtime.

**Decision**: Add temporary diagnostic logging to the `Mod-a` handler and to the copy event to capture (a) `doc.length` before/after, (b) `selection.main` after, (c) text length sent to clipboard. User reproduces once and reports console output. Root cause is then fixed directly.

**Consequences**: One extra dev iteration to get the runtime data; avoids speculative fixes that might miss the actual cause.

## Implementation Plan

* **Step 1** (diagnostic): Wrap the `Mod-a` handler in `EditorView.tsx:259` with a logging wrapper. Add a `copy` event handler to `EditorView.domEventHandlers` (markdown-only branch) that logs clipboard text length. Keep changes minimal.
* **Step 2** (user repro): User opens a problematic large md file, presses Cmd+A then Cmd+C, copies console output, reports back.
* **Step 3** (root cause fix): Based on diagnostic output, fix at the shared path. Remove diagnostic logging.
* **Step 4** (verification): User reproduces again — Cmd+A → Cmd+C → paste into new file → content matches source byte-for-byte.

## Definition of Done

* Root cause identified and fixed at the shared path.
* Diagnostic log removed before commit.
* Minimal repro confirmed before/after fix.
* Lint / typecheck green.

## Out of Scope (explicit)

* Performance optimization for huge files (> 100k lines) beyond fixing Cmd+A → Cmd+C.
* Changes to search, paste, or unrelated editor features.
* Changes to non-markdown file types' editors (JSON viewer has its own CodeMirror setup at `apps/desktop/src/components/file-types/json/editor/Json5CodeMirror.tsx` — out of scope unless same root cause).

## Technical Notes

* Files inspected:
  - `apps/desktop/src/editor/EditorView.tsx` (keymap, mount, update listener, replaceContent)
  - `apps/desktop/src/editor/extensions/*.ts` (no selection interception)
  - `apps/desktop/src/components/work-area/EditorPane.tsx` (externalContentVersion sync)
  - `apps/desktop/src/store/editorStore.ts` (openFile, updateTabContent, setContentExternal)
  - `apps/desktop/src/store/vaultStore.ts` + `packages/vault-provider/src/vaultManager.ts` + `packages/vault-provider/src/providers/tauriProvider.ts` (readFile path)
  - `apps/desktop/src-tauri/tauri.conf.json`, `src-tauri/src/lib.rs` (global shortcuts — only pet-toggle, no Cmd+A)
  - `node_modules/.pnpm/@codemirror+commands@6.10.3/.../dist/index.js:1053` (selectAll source)
  - `node_modules/.pnpm/@codemirror+view@6.41.0/.../dist/index.js:5100-5160` (copy handler source)
