# Research: Source format for mind-map round-trip

- **Query**: Which plain-text source format best supports bidirectional lossless round-trip with an editable mindmap canvas?
- **Scope**: mixed (internal repo deps + format knowledge)
- **Date**: 2026-07-14

## Findings

### Format comparison

| Format | Parser (npm, already installed?) | Lossless? | Human-readable / git-diff | Metadata loss (collapsed/color/links) | Mindmap lib native emit/consume |
|---|---|---|---|---|---|
| **Markdown bullets** (`# Title\n- A\n  - A1`) | `remark-parse` (installed) | Partial — text + tree only | Excellent | Yes — no place to put collapsed/color/link per node | markmap consumes (read-only render); mind-elixir has `importMarkdown`/`exportMarkdown` (lossy) |
| **OPML** (XML `<outline>`) | `fast-xml-parser` (installed) | Partial — text + tree; `note` attr for note | Verbose, noisy diffs | Loses color; `_collapse` attr can hold collapsed | No major editable JS mindmap lib emits OPML natively (WorkFlowy/Roam interop, not markmap/mind-elixir) |
| **Custom indented** (2-space, one line per node) | Hand-written (~30 lines) or reuse `yaml` parser with `- ` prefix | Lossless for text+tree only | Excellent | No metadata slot without custom syntax | None — every consumer is custom |
| **JSON tree** | stdlib `JSON.parse` | Fully lossless (any metadata fits in node object) | Poor — single-line or noisy; git diff unfriendly, commas/quotes | None — schema is freeform | mind-elixir & jsmind store internal model as JSON natively |
| **Indented YAML** (`- A\n  - A1`) | `yaml` (installed) | Lossless for tree+text; per-node metadata via nested mapping | Good (line-based diffs) | Survives if node is a map with `text:` + `color:`/`collapsed:` keys | None native; needs adapter |

### Round-trip losslessness detail

The hybrid model requires every canvas edit (text change, reparent, add, delete) to survive text→canvas→text. For **structural ops only** (text + parent/child), all five formats round-trip. The failure mode is **node-level metadata** (collapsed state, color, link URL, note body):

- Markdown bullets: nowhere lossless to put `collapsed:true` or `color:#f00` on a node. markmap encodes some via HTML comment tricks (`<!-- -->`) — brittle and lossy.
- OPML: `<outline text="A" _collapse="1" color="#f00"/>` — possible but ad-hoc, no schema.
- Custom indent: must invent syntax (`A [collapsed] {#f00}`), then write+debug the parser. Ponytail violation — hand-rolled parser.
- JSON: lossless, but unreadable and bad diffs.
- YAML: lossless + readable, with per-node map: `- text: A\n  collapsed: true\n  color: "#f00"\n  children:\n    - text: A1`. Diff-friendly (one line per scalar change).

### Parser availability in this repo

Already installed (no new dep needed):
- `remark-parse@^11` + `unified@^11` — markdown bullets
- `fast-xml-parser@^5` — OPML
- `yaml@^2.9` — indented YAML / JSON-superset YAML
- `json5` — JSON-with-comments (not in candidate list but viable)
- stdlib `JSON` — JSON tree

NOT installed: any mindmap lib, OPML-specific helper, markmap.

### Human-readability & git-diff friendliness (ranked)

1. Markdown bullets — most familiar, line-based diffs
2. Indented YAML — line-based, explicit keys readable
3. Custom indented — simplest, but unknown to readers
4. OPML — verbose XML, attribute-heavy, noisy diffs
5. JSON — worst diffs (commas, quotes, reflow)

### Codebase patterns (relevant)

- File-type handler contract: `apps/desktop/src/components/file-types/markdown/index.ts` shows the `FileTypeHandler` shape (`extensions`, `supportedViewModes`, `needsFileContent`, `Preview`). New handler mirrors this.
- DBML handler (`file-types/dbml/`) is the closest precedent: split source (CodeMirror) + visual graph (`@antv/x6`). Reuses pattern of parse → tree model → layout → render.
- `PreviewProps` already has `onChange?: (content: string) => void` (per PRD line 11) — round-trip write-back path exists; only serialization choice remains.
- `@antv/x6` already a dep; `d3-force` available but DBML-only so far.

## Recommendation

**Top pick: Markdown bullet list (markmap convention), parsed by `remark-parse` (already installed).**

Rationale (YAGNI + ponytail):

- The PRD's own `Ponytail flag` (prd.md:30) says: "先做最小可工作往返（纯文本 + 层级），样式/折叠/位置等元数据先丢，等需求出现再加." That decision collapses the differentiator — for **text + tree only**, markdown bullets round-trip losslessly and parser is already in `node_modules`.
- Most familiar to note-takers; best git diffs; no new dependency; markmap ecosystem alignment.
- The metadata-loss problem is **shared by every plain-text format except JSON/YAML-map**, and YAML-map costs readability for metadata the user has explicitly deferred. Re-evaluate when (if) the user asks for per-node color/collapsed persistence — at that point, upgrade to YAML-map or a JSON sidecar, not before.
- Compatible with the most likely editable canvas libs: mind-elixir ships `importMarkdown`/`exportMarkdown` utilities (lossy on metadata, lossless on text+tree — matches the deferred-metadata plan).

**Fallback if metadata must be persisted now**: Indented YAML (`yaml` package, already installed) with per-node map `{text, collapsed?, color?, children?}`. Still no new dep, still readable, fully lossless. Pick this only when the user actually asks for color/collapsed persistence.

**Do not pick**: OPML (no native consumer among editable JS mindmap libs), custom indented (hand-rolled parser = ponytail violation), plain JSON (unreadable, bad diffs).

## Caveats / Not Found

- Did not verify mind-elixir's exact `importMarkdown`/`exportMarkdown` API shape via web search — confirmed from PRD's prior research summary (prd.md:59) only. Implementation should `npm view mind-elixir` or read its README before locking the serialization contract.
- "Lossless" here means *for the MVP scope the PRD defers* (text + hierarchy). If the user later demands color/collapsed/link persistence, markdown bullets become lossy and the recommendation must be revisited.
- File extension choice (`.mmap` / `.mnd` / `.tn`) is orthogonal to format choice; markdown-bullets-as-source can use any extension (markmap uses `.mm.md` conventionally).
