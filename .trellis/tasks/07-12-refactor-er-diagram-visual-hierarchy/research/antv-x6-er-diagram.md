# Research: @antv/x6 for ER Diagram Preview

- **Query**: Re-implement ER diagram preview with @antv/x6, preserving the just-finished visual-hierarchy refactor (neutral headers, collapsed note/index chip, enum dashed border + «enum», grid default off).
- **Scope**: external (npm registry, GitHub raw, official docs) + internal (current SVG renderer + data layer)
- **Date**: 2026-07-12

## 1. Version + API surface (verified 2026-07-12)

| Package | `latest` tag | Actually-published v3 | Peer of v3 |
|---|---|---|---|
| `@antv/x6` | **3.1.7** (Mar 2026) | 3.1.7 | — |
| `@antv/x6-react-shape` | **3.0.1** | 3.0.1 | `@antv/x6@^3.x`, `react@>=18` |
| `@antv/x6-plugin-snapline` | 2.1.7 | **3.0.0** (install explicitly) | `@antv/x6@^3.x` |
| `@antv/x6-plugin-transform` | 2.1.8 | **3.0.0** | `@antv/x6@^3.x` |
| `@antv/x6-plugin-selection` | 2.2.2 | **3.0.0** | `@antv/x6@^3.x` |
| `@antv/x6-plugin-keyboard` | 2.2.3 | **3.0.0** | `@antv/x6@^3.x` |
| `@antv/x6-plugin-clipboard` | 3.0.0 | 3.0.0 | `@antv/x6@^3.x` |
| `@antv/x6-plugin-stencil` | 2.1.5 | 3.0.0 | + `@antv/x6-plugin-dnd@^3.x` |
| `@antv/x6-react-node` | **404 (unpublished)** | — | — |

> **Critical gotcha**: the v3 ecosystem exists but every plugin's `latest` dist-tag still points to a v2.x version with peer `@antv/x6@^2.x`. A bare `npm install @antv/x6-plugin-snapline` will install v2.1.7, which NPM will refuse to satisfy alongside `@antv/x6@3.x`. **Must pin every plugin to `@3.0.0` explicitly**. The user's task brief assumed "v2 API" — that's stale; current major is v3, and v2 has not been touched since 2024-01 (`2.18.1`).

- React wrapper is **`@antv/x6-react-shape`** (the brief's mention of `@antv/x6-react-node` is wrong — that package 404s on npm).
- Registration API (v3, confirmed in `examples/src/pages/table/component.tsx`):
  ```ts
  import { register } from '@antv/x6-react-shape'
  import { Graph } from '@antv/x6'
  import { TableNode } from './TableNode' // your React component

  register({
    shape: 'er-table',
    component: TableNode,
    width: 240,
    height: 120,
    ports: { /* groups: in/out, layout */ },
  })
  // later:
  graph.addNode({ shape: 'er-table', x, y, data: { table }, ports: [...] })
  ```
- Class-based alternative: extend `ReactShapeView` (see `examples/src/pages/table/view.ts` — `class TableNodeView extends ReactShapeView`). Only needed when you need custom edge-port resolution (e.g. virtual ports for scrollable lists). Our table cards are short and don't scroll, so the functional `register()` form is enough.
- Official docs:
  - About: https://x6.antv.antgroup.com/tutorial/about
  - Quick start: https://x6.antv.antgroup.com/tutorial/getting-started
  - React intermediate: https://x6.antv.antgroup.com/tutorial/intermediate/react
  - Examples hub: https://x6.antv.antgroup.com/examples
  - Repo: https://github.com/antvis/x6

## 2. ER conventions + minimal plugin set

X6 does **not** ship a dedicated ER shape kit. ER diagrams are built from: a custom React node for the table card + ports for each field row + the built-in **`er` router** (confirmed at `src/registry/router/er.ts`) + `connector: 'rounded'`. The official table example (`examples/src/pages/table/index.tsx`) does exactly this:

```ts
new Graph({
  container,
  width: 800, height: 600,
  connecting: {
    router: { name: 'er', args: { direction: 'H' } },
    connector: 'rounded',
    connectionPoint: 'anchor',
  },
})
```

Other useful routers in `src/registry/router/`: `manhattan`, `orth`, `metro`, `oneside`, `normal`, `loop`. Other connectors: `normal`, `smooth`, `jumpover`, `loop`.

**Minimal plugin set for our read-mostly ER preview** (we are not building a full editor — no drag-from-palette, no undo tree, no copy/paste):

| Plugin | Why | Verdict |
|---|---|---|
| `@antv/x6-plugin-transform` | pan / zoom / mouse-wheel | **required** (replaces our hand-rolled `setZoom`/`setPanX/Y`) |
| `@antv/x6-plugin-selection` | rubber-band + click multi-select for "highlight refs of selected table" (out of scope per PRD, but cheap) | optional, skip for MVP |
| `@antv/x6-plugin-snapline` | alignment guides on drag | skip — we have d3-force + manualPositions, snap adds noise |
| `@antv/x6-plugin-keyboard` | del/undo | skip — preview, not editor |
| `@antv/x6-plugin-clipboard` | copy/paste | skip |
| `@antv/x6-plugin-stencil` | drag-from-palette panel | skip — no panel, files come from DBML source |
| `@antv/x6-plugin-minimap` | optional minimap for large schemas | defer |
| `@antv/x6-plugin-scroller` | pan canvas with scrollbars | optional — useful if schemas overflow the viewport |

**Recommendation: install only `@antv/x6-plugin-transform@3.0.0` for MVP.** It gives us wheel-zoom-toward-cursor + drag-pan for free, replacing ~120 lines of hand-rolled `onWheel` + `panStateRef` code in `ErDiagramPreview.tsx` (lines 207-333).

## 3. Custom ER node shape: SVG `Markup`/`attrs` DSL vs React component

Two paths:

### (a) Pure SVG via Markup + attrs DSL
```ts
Graph.registerNode('er-table', {
  width: 240, height: 120,
  markup: [
    { tagName: 'rect', selector: 'body' },
    { tagName: 'line', selector: 'header-divider' },
    { tagName: 'text', selector: 'title' },
    // ...one text per field row
  ],
  attrs: {
    body: { fill: 'var(--surf)', stroke: 'var(--brd)', rx: 6, ry: 6 },
    title: { fontSize: 13, fontWeight: 700, fill: 'var(--t1)', refX: 12, refY: 15 },
    // ...
  },
})
```
- Pro: lighter (no React reconciler per node), smaller bundle, no re-render cost on every prop change.
- Con: row layout is manual math; the collapsed-chip toggle requires `node.prop()` updates that re-derive all attrs; the existing ~600 lines of SVG JSX in `ErDiagramPreview.tsx` (TableCard / EnumCard / EnumExpandedBlocks / ChipRow) has to be re-expressed in the DSL, which is verbose and lossy for things like `<title>` tooltips and per-row `<line>` dividers.

### (b) React component via `@antv/x6-react-shape`
```ts
import { register } from '@antv/x6-react-shape'
register({
  shape: 'er-table',
  component: (props) => <TableCardNode node={props.node} />,
  width: 240, height: 120,
})
```
- Pro: **direct port of existing `TableCard` / `EnumCard` JSX** — same `<rect>`/`<text>`/`<line>` SVG inside the React component, same CSS variables, same `expandedNotes` Set state lifted to a Zustand store or `node.setData({ expanded })` + `node.hasChanged('data')` check (pattern from `component.tsx` `shouldComponentUpdate`).
- Con: React reconciler runs per node (fine for <100 tables; schemas rarely exceed that); react-shape adds ~5KB gz on top of x6 core.

**Recommendation: (b) React component.** Our `ErDiagramPreview.tsx` already has 600+ lines of mature SVG JSX with the exact visual-hierarchy decisions (neutral header, chip collapse, «enum» tag, dashed enum border, KeyIcon). Porting that wholesale into a `register()`-ed React component is the shortest diff. The DSL path would be a from-scratch rewrite of every visual decision the just-finished refactor made.

## 4. Data-layer portability

`parseDbml.ts` (returns `ErSchema { tables, enums, refs, projectName, databaseType, projectNote }`) is **untouched** — it's a pure data factory, exactly what X6 wants as `graph.fromJSON({ nodes, edges })` input.

`erLayout.ts` (d3-force + `estimateTableSize` + `fieldAnchor` + `orthoRefPath`) — three options:

| Option | Diff cost | Risk |
|---|---|---|
| **A. Keep d3-force, feed positions to X6** | small — call `layoutEr(schema, w, h, manual)` once, then `graph.addNode({ shape: 'er-table', x: t.x, y: t.y, data: { table: t } })` | low — manual-position preservation logic (lines 41, 264-285 of preview) survives; X6 just renders at given x/y |
| B. Switch to `@antv/layout` dagre | medium — re-derive enum sizing, lose manualPositions | high — `@antv/layout` is a separate ~200KB dep; dagre is layered (top-to-bottom) which is wrong for ER (ER wants organic cluster layout); we'd re-import the `estimateTableSize` math anyway |
| C. Use X6 built-in force layout | large — X6 v3 doesn't ship a force layout plugin; would pull `@antv/layout` anyway | high |

**Recommendation: Option A.** Keep `parseDbml` + `erLayout` + `manualPositionsRef` exactly as-is. Replace only the rendering layer (the `Diagram` / `TableCard` / `EnumCard` / `recomputeRefs` block in `ErDiagramPreview.tsx` lines 126-598) with an X6 `Graph` instance. The `refEndpoints()` anchor math is replaced by X6's `er` router + port-per-field, which is more robust (ports follow field rows automatically when nodes resize).

One nuance: our `manualPositionsRef` (Map of table name → {x,y}) is preserved across content edits. With X6, persist positions into `node.prop('position', {x,y})` on `node:change:position` and re-apply after `graph.clear() + fromJSON()` on content change — same semantics, ~10 lines.

## 5. Edges / crow's-foot markers

Built-in markers in `src/registry/marker/`: `classic`, `block`, `circle`, `cross`, `diamond`, `ellipse`, `async`, `path` — **no `er-one` / `er-many`**. But the `path` marker (`src/registry/marker/path.ts`) accepts an arbitrary SVG path `d`, so we can port our existing marker `<path d="M 3 0 L 12 7 M 3 7 L 12 7 M 3 14 L 12 7">` directly:

```ts
import { Graph } from '@antv/x6'

// Register once at module load.
Graph.registerMarker('er-one', {
  tagName: 'line',
  attrs: { x1: 0, y1: 1, x2: 0, y2: 9, stroke: 'var(--t3)', strokeWidth: 1.4 },
  refX: 2, refY: 5,
  // orient handled by X6's marker placement
})
Graph.registerMarker('er-many', {
  tagName: 'path',
  d: 'M 3 0 L 12 7 M 3 7 L 12 7 M 3 14 L 12 7',
  fill: 'none', stroke: 'var(--t3)', strokeWidth: 1.3,
  refX: 12, refY: 7,
})

// Per-edge: pick marker by cardinality from ErRef.cardinality ('1' or '*').
graph.addEdge({
  source: { cell: fromTableId, port: fromFieldPortId },
  target: { cell: toTableId, port: toFieldPortId },
  router: { name: 'er', args: { direction: 'H' } },
  connector: 'rounded',
  attrs: {
    line: {
      stroke: 'var(--t3)', strokeWidth: 1.5, opacity: 0.9,
      sourceMarker: fromLabel === '1' ? 'er-one' : 'er-many',
      targetMarker: toLabel === '1' ? 'er-one' : 'er-many',
    },
  },
})
```

The existing `orthoRefPath` / `fieldAnchor` logic (lines 155-262 of `erLayout.ts`) **becomes unnecessary** — X6's `er` router does anchor-on-field-row routing natively when edges connect to per-field ports. This is a net deletion of ~120 lines of geometry code, but it's a behavioral change: port IDs must match field names, so a field rename will move the edge. Acceptable for MVP.

Alternative if exact path-matching with current rendering is required: skip X6 routing, use `router: 'normal'` + `connector: 'normal'` and pre-compute `path` from `refEndpoints()` (keep `erLayout.ts` fully), feed it as a custom edge `d`. Lower risk for visual-parity validation; switch to `er` router after.

## 6. Bundle size + lazy loading

x6 core gzip ~120-180KB (per the `img.badgesize.io` badge in README, varies by version). Plugins add ~5-15KB each. For a Tauri desktop app where `.dbml` is one of ~15 file-type previews, lazy-loading is mandatory — same pattern the codebase already uses for `@dbml/core` (see `parseDbml.ts` lines 72-79).

```tsx
// apps/desktop/src/components/file-types/dbml/index.ts
// Existing: static import of the SVG renderer. Change to React.lazy.
import { lazy, Suspense } from 'react'

const ErDiagramX6 = lazy(() => import('./ErDiagramX6'))
const ErDiagramSvg = lazy(() => import('./ErDiagramSvg')) // fallback during migration

export function ErDiagramPreview({ content }: PreviewProps) {
  return (
    <Suspense fallback={<div className="…">正在加载 ER 渲染器…</div>}>
      <ErDiagramX6 content={content} />
    </Suspense>
  )
}
```

Inside `ErDiagramX6.tsx`, dynamic-import x6 inside `useEffect` so the chunk loads only on first mount:

```tsx
useEffect(() => {
  let cancelled = false
  ;(async () => {
    const [{ Graph }, { register }] = await Promise.all([
      import('@antv/x6'),
      import('@antv/x6-react-shape'),
    ])
    const { default: Transform } = await import('@antv/x6-plugin-transform')
    if (cancelled) return
    register({ shape: 'er-table', component: TableCardNode, width: 240, height: 120 })
    register({ shape: 'er-enum',  component: EnumCardNode,  width: 200, height: 100 })
    const graph = new Graph({ container: ref.current!, grid: false, panning: true, mousewheel: true, ... })
    graph.use(new Transform({ panning: true, mousewheel: true }))
    // fromJSON({ nodes, edges }) from parseDbml + erLayout output
    setGraph(graph)
  })()
  return () => { graph?.dispose() }
}, [])
```

Vite automatically code-splits the dynamic imports into separate chunks; Tauri's webview loads them on demand.

## 7. License

**MIT**, verified two ways:
- `npm view @antv/x6 license` → `MIT`
- `https://raw.githubusercontent.com/antvis/x6/master/LICENSE` → "MIT License, Copyright (c) 2021-2025 Alipay.inc"

Safe for our use. `@antv/x6-react-shape` and all plugins listed in §1 are also MIT.

## 8. Migration plan (smallest diff first)

| Step | Files | Verifies |
|---|---|---|
| **0. (no code yet) Pin versions** | Add to `apps/desktop/package.json` deps: `@antv/x6@^3.1.7`, `@antv/x6-react-shape@^3.0.1`, `@antv/x6-plugin-transform@3.0.0` | install resolves without peer warnings |
| **1. New X6 renderer, old SVG kept as fallback** | New file `apps/desktop/src/components/file-types/dbml/ErDiagramX6.tsx` (~300 lines, ports the JSX from `TableCard`/`EnumCard` into `register()`-ed React components). `index.ts` switches to `React.lazy(() => import('./ErDiagramX6'))`. `ErDiagramPreview.tsx` renamed `ErDiagramSvg.tsx` and kept reachable via a feature flag or env toggle for parity testing. | X6 renders the same DBML with neutral headers, dashed enums, chip collapse — visual parity vs the just-shipped SVG version. |
| **2. Cut over edges + crow's-foot** | Inside `ErDiagramX6.tsx`, add edges with `router: 'er'`, register `er-one`/`er-many` markers per §5. Drop `recomputeRefs()` (no longer needed — X6 reroutes on node move automatically). | Refs follow dragged tables; crow's-foot markers match the SVG version. |
| **3. Delete old SVG path** | Remove `ErDiagramSvg.tsx`, the `orthoRefPath`/`fieldAnchor`/`refEndpoints` helpers in `erLayout.ts` that are now unused. Keep `parseDbml.ts`, `estimateTableSize`, `layoutEr`, `wrapText`, `tablesBounds`, `manualPositionsRef` — they still feed X6. | One renderer, less code than before the refactor. |

**Files that survive**: `parseDbml.ts` (data layer, untouched), `erLayout.ts` (d3-force + sizing, mostly untouched — only the `refEndpoints`/`orthoRefPath`/`fieldAnchor` block gets deleted in step 3), `parseDbml.test.ts`.

**Files replaced**: `ErDiagramPreview.tsx` (1179 lines) → `ErDiagramX6.tsx` (~300 lines, since X6 absorbs pan/zoom/drag/edge-routing).

**Net code change estimate**: -700 lines after step 3.

## Caveats / Not Found

- The `latest` dist-tags still pointing to v2.x for plugins is a known friction point; if the team prefers tag-based installs, file an issue upstream or just document the `@3.0.0` pin in `package.json`.
- Could not fetch `src/registry/router/er.ts` source (raw.githubusercontent timed out repeatedly during research); the file's existence and the official table example using `router: { name: 'er' }` confirm the API, but the exact `args` shape (`direction: 'H' | 'V'`) should be verified against the live docs page when implementing.
- `@antv/x6-plugin-transform@3.0.0` API (`new Transform({ panning, mousewheel })`) is inferred from v2 docs + the v3 example pattern; verify the constructor options in the v3 changelog before relying on it.
- Bundle size number is approximate; measure with `vite build` + `rollup-plugin-visualizer` before/after the switch.
