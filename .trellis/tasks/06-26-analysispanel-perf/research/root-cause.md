# Research: AnalysisPanel open-time freeze root cause

- **Query**: Why does the 「项目分析」 sidebar panel open slowly and freeze the page?
- **Scope**: internal
- **Date**: 2026-06-26

## TL;DR (Root cause)

The freeze is **NOT** in `loadReports()`. The actual root cause is that
opening the analyze panel reactivates the first open `reports/*.html` tab, and
`WorkArea` synchronously mounts the GrapesJS visual editor
(`HtmlVisualEditor` → `GrapesEditor` → `useGrapesEditor`) on the **26 MB**
`reports/2026-06-14-quill.html`. Both `parseHtmlForGrapes(content)` (run
during React render via a `useRef` initializer) and `editor.setComponents(...)`
(run inside `useEffect`) are O(n) synchronous main-thread work over ~26 MB of
HTML, blocking the page for many seconds. A secondary amplifier is the
`key={activeTab.id-externalContentVersion}` on `<handler.Editor>` in
`WorkArea.tsx:295`, which remounts GrapesJS (re-parse + re-init) every time
the file watcher bumps `externalContentVersion`.

`loadReports()` itself is fast for the current 3-report vault, but it does
perform N sequential `stat()` IPC calls inside `TauriVaultProvider.listFiles`
that would become a bottleneck at hundreds of reports. Ranked bottlenecks
below.

## Evidence

### 1. The 26 MB report on disk — the smoking gun

```
$ ls -la /Users/yiminlin/quill/default_vault/reports/
-rw-r--r--  83145 bytes  2026-06-14-drawio-skill.html
-rw-r--r-- 26887926 bytes 2026-06-14-quill.html        ← 26 MB
-rw-r--r--  60211 bytes  2026-06-14-trellis.html
-rw-r--r--      40 bytes 2026-06-14-quill.tags.json
```

`reports/2026-06-14-quill.html` is 26 MB of self-contained HTML (huge inline
`<style>` blocks, repeated CSS, large DOM). No other report exceeds 100 KB.

### 2. How the panel switch triggers GrapesJS on that 26 MB

`ActivityBar.tsx:48-56` — clicking the 项目分析 icon calls `onPanelChange('analyze')`.

`editorStore.ts:176-185` — `setActivePanel` auto-activates the first tab whose
`activity === 'analyze'`:

```ts
setActivePanel: (panel) => {
  set((state) => {
    const firstTabOfPanel = state.tabs.find((t) => t.activity === panel);
    return {
      activePanel: panel,
      activeTabId: firstTabOfPanel?.id ?? null,
    };
  });
},
```

If `reports/2026-06-14-quill.html` was previously opened (or restored via
`restoreOpenTabs` on vault switch/init, `editorStore.ts:498-581`), it becomes
the active tab the moment the user clicks the analyze activity.

`WorkArea.tsx:292-303` renders the HTML handler's custom editor with a
content-driven remount key:

```tsx
{showCustomEditor && activeTab && handler?.Editor && activeTab.fileType !== 'web' && (
  <div className={`flex-1 flex flex-col overflow-hidden editor-${handler.id}`}>
    <handler.Editor
      key={`${activeTab.id}-${externalContentVersion}`}
      content={activeTab.content}
      tabId={activeTab.id}
      filePath={activeTab.path}
      onChange={(content) => updateTabContent(activeTab.id, content)}
      onSave={() => markTabDirty(activeTab.id, false)}
    />
  </div>
)}
```

For `fileType === 'html'`, `handler.Editor` is `HtmlVisualEditor`
(`file-types/html/index.ts:14`), which in visual mode renders `GrapesEditor`
(`HtmlVisualEditor.tsx:85-91`).

### 3. The blocking call: `parseHtmlForGrapes` runs during render

`useGrapesEditor.ts:91-94`:

```ts
const parsedRef = useRef<ParsedHtml | null>(null);
if (parsedRef.current === null) {
  parsedRef.current = parseHtmlForGrapes(content);
}
```

This is a `useRef` initializer that runs **during React's render phase** (not
inside `useEffect`). `parseHtmlForGrapes` (`grapesContentPipeline.ts:56-124`)
calls `new DOMParser().parseFromString(rawHtml, 'text/html')` and then walks
`doc.head`, `doc.body`, `querySelectorAll('script')` — all synchronous, all on
the main thread, all over 26 MB of HTML. React cannot interrupt this, so the
sidebar (`AnalysisPanel`) and the work area paint only after the parse
completes. This is the "opens very slowly" phase.

Then `useGrapesEditor.ts:141-240` `useEffect` runs:

```ts
const parsed = parseHtmlForGrapes(content);          // re-parse, 26 MB, again
parsedRef.current = parsed;
...
editor = grapesjs.init(config);                       // heavy iframe + model setup
...
editor.setComponents(parsed.bodyContent || '');       // GrapesJS parses 26 MB body
editor.setStyle(parsed.styleBlocks.join('\n'));
```

`editor.setComponents` on a 26 MB body is the second blocking hit — GrapesJS
builds its component tree from raw HTML synchronously. This is the "after
opening, the entire page freezes" phase. Even after mount completes, the
editor holds the 26 MB model in memory; every selection / drag / style tweak
triggers more O(n) work, and the debounced `editor.getHtml()` +
`reconstructHtml` in `scheduleContentExtraction` (`useGrapesEditor.ts:123-138`)
serializes 26 MB each fire.

### 4. The remount amplifier

`WorkArea.tsx:295` — `key={`${activeTab.id}-${externalContentVersion}`}`.

`externalContentVersion` is bumped by `setContentExternal`
(`editorStore.ts:254-263`) whenever the file watcher detects an external
change to an open tab's file (`fileWatcher.ts:51-92`). For a 26 MB report
that's also being edited (or whose sidecar/tags get touched), each bump
unmounts `HtmlVisualEditor` and remounts a fresh `GrapesEditor` — re-running
`parseHtmlForGrapes` + `grapesjs.init` + `editor.setComponents` on 26 MB.
Repeated hard freezes.

### 5. `loadReports` — NOT the freeze, but sub-optimal

`analysisStore.ts:129-154`:

```ts
const entries = await manager.listFiles('reports', true, false).catch(() => []);
const htmlFiles = flattenHtmlFiles(entries).sort((a, b) => b.name.localeCompare(a.name));
const reports: ReportMeta[] = await Promise.all(
  htmlFiles.map(async (file) => ({
    path: file.path,
    name: file.name,
    tags: await readTags(file.path),
  })),
);
```

Two sub-optimalities, neither fatal at N=3:

- **Sequential `stat()` per file** in `TauriVaultProvider.listFiles`
  (`tauriProvider.ts:117-134`): the for-loop `await stat(fullEntryPath)` per
  file is sequential IPC. With N reports this is N round-trips. At N=3 it's
  ~3 calls; at N=200 it would be a real delay. `AnalysisPanel` does not use
  `entry.size` / `entry.lastModified` at all — the stats are pure waste.
- **Per-report sidecar read** via `Promise.all` of `readTags` →
  `vault.readFile(.tags.json)` (`analysisStore.ts:91-104`,
  `tauriProvider.ts:61-68`). Concurrent, so OK at low N, but for missing
  sidecars each call still crosses the IPC boundary and throws
  `NOT_FOUND`. 2 of 3 reports here have no sidecar.

`loadReports` does **not** read the HTML file contents — only sidecars. So it
is not the source of the 26 MB freeze.

### 6. Second trigger path: clicking a report card

`AnalysisPanel.tsx:88-94` — `ReportCard.handleOpen` calls
`openFile(report.path, report.name)`. `editorStore.ts:410-418` reads the full
file via `vault.readFile` (Tauri `readTextFile` returns the entire 26 MB as a
JS string), stores it as `tab.content`, then WorkArea renders
`HtmlVisualEditor` → same GrapesJS freeze as path 1. So even from a cold
start (no pre-open tab), clicking the quill report card will freeze the app.

## Why it freezes (complexity summary)

| Step | Cost | Where |
|---|---|---|
| `parseHtmlForGrapes(26 MB)` during render | O(n) sync, ~seconds | `useGrapesEditor.ts:91-94` → `grapesContentPipeline.ts:56-124` |
| `grapesjs.init(config)` | heavy sync iframe/model setup | `useGrapesEditor.ts:168` |
| `editor.setComponents(26 MB body)` | O(n) sync GrapesJS parse | `useGrapesEditor.ts:192` |
| `editor.setStyle(...)` | O(css) sync | `useGrapesEditor.ts:193` |
| `editor.getHtml()` + `reconstructHtml` (debounced) | O(n) per change | `useGrapesEditor.ts:114-116, 130-133` |
| Remount on `externalContentVersion` bump | re-runs all of the above | `WorkArea.tsx:295` |
| `vault.readFile(26 MB)` on click | IPC + 26 MB string alloc | `editorStore.ts:416` → `tauriProvider.ts:61-68` |

The first three are the open-time freeze. The remount amplifier and the
per-change serialization are the "page stays frozen" tail.

## Fix options

### Option A — Size guard + lazy visual mode (smallest blast radius)

Refuse to mount GrapesJS for HTML files above a threshold (e.g. 512 KB /
1 MB). For oversized files, default `HtmlVisualEditor` to `source` or
`preview` mode (CodeMirror / iframe, both already exist) and show a banner
like "此报告过大，可视化编辑已禁用". Optionally lazy-mount GrapesJS only
when the user explicitly clicks "可视化".

- **Pros**: Directly eliminates the 26 MB parse. Trivial to implement (a
  size check on `content.length` in `HtmlVisualEditor` / `useGrapesEditor`).
  No IPC changes. CodeMirror and iframe `srcDoc` already handle large HTML
  acceptably.
- **Cons**: Visual editing is disabled for the very file the user is most
  likely to care about. Doesn't fix the underlying GrapesJS scaling.
- **Effort**: XS (~1-2 hours).

### Option B — Move metadata extraction to Rust; cache in sidecar (addresses `loadReports` only)

Add a Tauri command `list_reports(dir) -> Vec<ReportMetaDto>` that lists
`*.html`, reads sidecars, and returns a single JSON payload in one IPC call.
Drop the per-file `stat()` and per-file sidecar `readFile`. Optionally cache
by mtime in the sidecar.

- **Pros**: Removes the N sequential IPC round-trips in `listFiles` /
  `readTags`. Scales to hundreds of reports.
- **Cons**: **Does not fix the actual freeze** (GrapesJS on 26 MB). Only
  improves panel-list load time at scale. Larger change (new Rust command +
  provider method + store wiring).
- **Effort**: M (~half day).

### Option C — Stop auto-activating the first analyze tab on panel switch

Change `setActivePanel('analyze')` so it does NOT reset `activeTabId` to the
first analyze tab. Let the user pick a tab explicitly (or keep the current
editor view as-is). Combined with Option A, this means switching to the
analyze sidebar never triggers a 26 MB GrapesJS mount.

- **Pros**: Eliminates path-1 freeze (panel switch reactivating the quill
  tab) without touching GrapesJS. Small, surgical store change.
- **Cons**: Behavior change — users who expected the report to auto-display
  on panel open lose that. Doesn't fix path-2 (clicking the report card).
- **Effort**: XS (~1 hour).

### Option D — Virtualize + defer GrapesJS parse to a Web Worker / idle callback

Wrap `parseHtmlForGrapes` in `setTimeout`/`requestIdleCallback` so React can
paint the sidebar first; move the actual DOMParser into a Web Worker; have
GrapesJS mount with a placeholder until parse completes. Also drop
`externalContentVersion` from the `key` in `WorkArea.tsx:295` and instead
push content updates into the live editor via a ref method.

- **Pros**: Keeps visual editing for large files. Removes the render-phase
  block and the remount loop.
- **Cons**: Largest engineering effort. GrapesJS is not Worker-friendly (it
  needs DOM), so realistically only `parseHtmlForGrapes` can move off the
  main thread; `editor.setComponents` still blocks. Risk of editor/preview
  desync.
- **Effort**: L (~1-2 days).

## Recommended fix

**Option A + Option C together.**

Reasoning:

1. The dominant cost is GrapesJS parsing 26 MB synchronously. Option A
   (size guard, default to source/preview for oversized HTML) is the
   smallest, most direct fix and immediately eliminates the freeze for the
   known-bad file. It also protects against future large reports.
2. Option C prevents the panel-switch from silently reactivating a huge tab,
   removing the "I just clicked the sidebar and the app died" path. It's a
   one-line store change with no risk to the editor.
3. Option B (Rust-side listing) is worth doing later for scalability, but
   with N=3 reports it would not materially improve the current symptom.
   Recommend tracking it as a separate follow-up.
4. Option D is over-engineered for the current data; revisit if users
   actually need visual editing on multi-MB reports.

If the user confirms, the implementation work fits in Option A (size guard
in `HtmlVisualEditor.tsx` + a banner) + Option C (tweak
`setActivePanel` in `editorStore.ts`).

## Files referenced

- `apps/desktop/src/components/sidebar/AnalysisPanel.tsx`
- `apps/desktop/src/store/analysisStore.ts`
- `apps/desktop/src/services/githubAnalysisService.ts`
- `apps/desktop/src/store/vaultStore.ts`
- `apps/desktop/src/store/editorStore.ts`
- `apps/desktop/src/utils/fileWatcher.ts`
- `apps/desktop/src/components/work-area/WorkArea.tsx`
- `apps/desktop/src/components/shell/ActivityBar.tsx`
- `apps/desktop/src/components/file-types/html/index.ts`
- `apps/desktop/src/components/file-types/html/HtmlVisualEditor.tsx`
- `apps/desktop/src/components/file-types/html/GrapesEditor.tsx`
- `apps/desktop/src/components/file-types/html/useGrapesEditor.ts`
- `apps/desktop/src/components/file-types/html/grapesContentPipeline.ts`
- `packages/vault-provider/src/providers/tauriProvider.ts`
- `packages/vault-provider/src/vaultManager.ts`

## Caveats / Not found

- The task framing assumed `loadReports` was the bottleneck. Code reading
  shows it is not, for the current 3-report vault. The freeze is in the
  GrapesJS editor mount path, triggered by `setActivePanel('analyze')`
  reactivating the 26 MB `reports/2026-06-14-quill.html` tab.
- I did not run the app. Confirmation experiment: with the quill.html tab
  open, click the 项目分析 activity and time the freeze; then close the
  quill.html tab and click again — the freeze should disappear. That
  isolates path 1 from path 2.
- I did not inspect whether `restoreOpenTabs` actually reopens quill.html on
  this user's startup; if it does, the freeze may also occur at app start
  (whenever the active panel is `analyze`). The persisted-tab data lives in
  the Tauri storage backend; checking that requires running the app.
- I did not measure GrapesJS parse time on 26 MB directly; the conclusion is
  inferred from the synchronous code paths + file size. A quick `console.time`
  around `parseHtmlForGrapes(content)` and `editor.setComponents(...)` in
  `useGrapesEditor.ts` would confirm exact durations.
