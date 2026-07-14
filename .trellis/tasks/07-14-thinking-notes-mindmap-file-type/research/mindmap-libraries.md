# Mindmap library research

## Recommendation: **mind-elixir**

Batter-included editable mindmap: drag-to-reparent, inline text edit, add sibling/child, delete, fold. MIT, TS-first, ESM/Vite-friendly, ~50-70 kb gz, lazy-loadable. JSON tree as source of truth (`topic`, `children`, `id`, `style`), emits `onDataChange`/`input` events on every edit.

## Comparison

| Lib | Canvas edit | Native data | Md in/out | Size (gz) | React | Maintenance | License |
|---|---|---|---|---|---|---|---|
| **mind-elixir** | Full (drag, inline, add, delete, fold) | JSON tree | No native; trivial converter | ~50-70 kb | Vanilla ref mount; thin community wrapper `mind-elixir-react` | Active, ~1.5-2k★, 2024 releases | MIT |
| jsmind | Yes (older UX) | `{meta, data:[nodes]}` | No | ~40-60 kb | Community `jsmind-react` stale | Slow maintenance, ~3k★ | BSD/MIT |
| @antv/x6 mindmap | DIY (no mindmap product) | X6 cell JSON | You own serializer | ~500 kb min (~120 kb gz) but **already in repo** so marginal cost 0 | `@antv/x6-react-shape` already in repo | Active | MIT |
| @antv/g6 mindmap | Plugin-level, analytics-leaning | g6 JSON | You own serializer | ~250 kb | No first-class React | Active | MIT |
| markmap (render-only) | No edit-out | mdast | Markdown in only | ~30 kb | `markmap-react` | Active render | MIT |

## Bidirectional round-trip feasibility

- mind-elixir: JSON tree is source of truth. ~30-line serializer emits Markdown bullets on every `onDataChange`. ~40-line `remark-parse` mdast walk ingests Markdown back to MindElixir node tree. Position/style/fold metadata dropped on round-trip — acceptable per PRD ponytail flag (defer until requested).
- jsmind: same story, older API, no advantage.
- @antv/x6: full DIY — only worth it if we want mindmap to share the DBML graph plumbing. ~5× the code for a standard mindmap product. Skip.
- markmap: out — no edit-out (canvases are SVG renderings of mdast).

## Why not x6 (already in repo)?

The DBML ER diagram uses `@antv/x6` + `@antv/x6-react-shape`. x6 already in deps. A mindmap could be built on x6 — but mind-elixir ships the entire editing UX (drag-reparent, keyboard shortcuts for sibling/child, fold) out of the box. Building that on x6 = hundreds of lines of custom node/edge wiring for parity. mind-elixir is 50-70 kb gz — not free, but the right cost for the saved code. Marginal-size argument for x6 only holds if mindmap shapes can reuse DBML node/edge classes — they can't (different layout algorithm, different interaction model).

## React integration

Vanilla ref mount in a `useEffect`, ~20-line hook. No need for `mind-elixir-react` wrapper (community, possibly stale). Container div + `new MindElixir({ el, data, ... })`, cleanup on unmount via `mindArea.destroy()`.

## Caveats / TODO before pinning

- Verify `npm view mind-elixir` locally (research ran with npm registry blocked).
- Confirm latest version supports current Vite + React 18.
- Check ESM/CJS interop in Vite build.
- If position/fold/color metadata becomes a real requirement later, extend source format with frontmatter or HTML-comment markers — out of scope per PRD.
