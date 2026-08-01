# AI Panel message file path clickable open

## Goal

Make file paths in AI Panel assistant messages clickable so the user can jump
straight to the referenced file (open it in the editor, optionally at a
line/col) instead of having to copy-paste / navigate the file tree.

## Requirements

- Inline-code tokens in **AiPanel assistant messages** that match a file-path
  shape (extension + optional `:line` / `:line:col` suffix) render as
  clickable links; clicking opens the file via `editorIoService.openFile`
  and jumps the cursor to `line:col` when present.
- Existence check: only render as clickable when the path resolves in the
  active vault, the external-file provider, or the wiki provider. Non-existent
  paths render as plain inline code (no click).
- Visual: keep inline-code styling, add hover color + `cursor: pointer` +
  subtle underline. No new dependency, no button chip.
- Apply only to AiPanel. Pet chat (`plaintext` path, secondary window) is
  unchanged — no `onPathClick` / `resolvePath` callback wired there.

## Acceptance Criteria

- [ ] Clicking an inline-code file path in an AiPanel assistant message opens
      the file (or focuses an already-open tab) and jumps to `line:col`.
- [ ] Non-path inline code (`someFunction`, `2026-01-01`, `foo()`) is NOT
      clickable.
- [ ] Path that fails existence check (e.g. `does-not-exist.ts`) renders as
      plain inline code — no cursor pointer, no click handler.
- [ ] Pet chat messages render unchanged (no clickable paths).
- [ ] Unit test: `matchFilePath` regex covers vault-relative, absolute,
      `~/`, `wiki:` prefixed, with `:line`, `:line:col`, and rejects
      non-paths.
- [ ] Unit test: `FilePathCode` renders clickable only when `resolvePath`
      returns true.

## Definition of Done

- Tests added (`matchFilePath.test.ts`, `FilePathCode.test.tsx`).
- Lint / typecheck / CI green.
- No new dependencies introduced.
- chat/ no-store-import rule preserved (path resolution injected via props).

## Technical Approach

### Detection (sync, in `components/chat/`)

New util `components/chat/filePath.ts`:

- `matchFilePath(raw: string): { path: string; line?: number; col?: number } | null`
  - Regex requires a path-shape string ending in a common extension
    (`.ts/.tsx/.js/.jsx/.mjs/.json/.md/.mdx/.markdown/.py/.rs/.go/.css/.scss/.html/.htm/.yml/.yaml/.toml/.ini/.svg/.png/.jpg/.jpeg/.gif/.webp/.pdf/.excalidraw/.drawio/.mmap/.web` …)
    optionally followed by `:line` or `:line:col`.
  - Accepts vault-relative (`notes/foo.md`), absolute (`/abs/path`),
    home-relative (`~/...`, `$HOME/...`), and `wiki:Name` shapes.
  - Rejects URLs (`http(s)://`), bare words, function calls, dates without
    extension.
- Module-level `Map<string, boolean>` existence cache (per session) so a
  repeated path across messages doesn't re-fetch.

### Rendering (sync, in `components/chat/`)

`MessageContent.tsx` adds two optional props:

```ts
onPathClick?: (path: string, line?: number, col?: number) => void;
resolvePath?: (raw: string) => Promise<boolean>;  // memoized cache inside
```

When `resolvePath` is undefined (pet chat), MessageContent renders inline
code as-is — no behavior change. When both are present (AiPanel), the
rehype-react `components.code` override:
- Detects inline code (no `hljs`/`language-` className → inline, not block).
- Calls `matchFilePath(children)`. If miss → default `<code>`.
- If hit → renders `<FilePathCode>` with `raw`, `onPathClick`, `resolvePath`.

`FilePathCode`:
- Initial render: plain `<code>` (matches existing styling) so streaming
  deltas don't flash clickable-then-plain.
- `useEffect` on mount: calls `resolvePath(raw)`. On true → setState
  `clickable=true`. On false / error → stays plain.
- When clickable: `<code>` with hover classes + `onClick` calling
  `onPathClick(path, line, col)`. Stop propagation so the bubble's other
  handlers don't fire.

### Consumer wiring (in `components/ai/`)

AiPanel passes the callbacks:

```ts
resolvePath={async (raw) => {
  // route by shape, mirroring editorIoService.readRawContent
  if (isExternalPath(raw)) try { await externalFileProvider.readFile(raw); return true; } catch { return false; }
  if (raw.startsWith('wiki:')) try { await wikiProvider.readFile(raw.slice(5)); return true; } catch { return false; }
  try { await useVaultStore.getState().readFile(raw); return true; } catch { return false; }
}}
onPathClick={async (path, line, col) => {
  const name = path.includes('/') ? path.slice(path.lastIndexOf('/') + 1) : path;
  await openFile(path, name);
  if (line) useEditorViewStateStore.getState().setCursorPosition(line, col ?? 1);
}}
```

Existence-check caching lives in `filePath.ts`'s module-level Map keyed by
`raw`, so the consumer's `resolvePath` is only called once per unique path
across the session.

### Cursor jump correctness

- For a freshly opened tab: `openFile` creates the tab with
  `cursorLine/cursorCol` undefined → after `setCursorPosition(line, col)`
  writes both runtime cursor and the active tab's cursorLine/cursorCol,
  EditorPane remounts (key includes `activeTab?.id`) and CodeMirror picks up
  `initialCursorLine/initialCursorCol`.
- For an already-open tab being reactivated: same flow — `setCursorPosition`
  writes the tab; EditorPane's `key` includes `activeTab?.id`, but if the
  tab was already active the editor doesn't remount, so the cursor won't
  visibly jump on the same-file re-click. Accepted for MVP (the click still
  opens/focuses the right file).

## Decision (ADR-lite)

**Context**: AI references file paths in inline code constantly; users want
click-to-open without leaving the chat surface.

**Decision**: Inject path-resolution + click callbacks via props on
`MessageContent` (slot pattern), keep detection/util in `components/chat/`.
No store imports added to chat/. Existence check is async with a session-
level Map cache.

**Consequences**:
- Pet chat gets the feature for free once it wires the callbacks (currently
  out of scope, but the slot is in place).
- Existence check fires one fs read per unique path per session — acceptable
  given typical message volume.
- Same-file-same-cursor re-click is a known minor UX gap (deferred).

## Out of Scope

- Detecting paths in plain text (outside inline code).
- Detecting paths in fenced code blocks.
- Same-file re-click cursor re-jump (CodeMirror effect-on-prop-change).
- Pet chat wiring (slot reserved, callbacks not passed).
- Visual chip / button styling.

## Technical Notes

- `MessageContent.tsx:32-42` — unified `processor`; inject `components.code`
  override via the `rehype-react` options.
- `editorIoService.ts:51` `readRawContent` — the routing pattern to mirror
  in `resolvePath`.
- `editorIoService.ts:81` `openFile(path, name)`.
- `editorViewState.ts:39` `setCursorPosition(line, col)` — writes both
  runtime cursor and active-tab `cursorLine/cursorCol`.
- `EditorPane.tsx:195` consumes `initialCursorLine`/`initialCursorCol`.
- `isExternalPath.ts` + `WIKI_PREFIX` (`types/wiki.ts`).
- chat/ no-store-import rule: `.trellis/spec/desktop/frontend/component-guidelines.md:151`.
