# Research: Infographic JSON Block Schema for Clips

- **Query**: Choose a JSON block schema (block types + layout model) for an LLM that turns a clipped web article into a poster-style infographic card rendered by React + Tailwind.
- **Scope**: mixed (internal code + external pattern research)
- **Date**: 2026-07-02

## Internal Context (where this plugs in)

| File | Relevance |
|---|---|
| `apps/desktop/src/components/file-types/clip/ClipCardView.tsx` | Current clip renderer. Parses frontmatter + `## 摘要` + `## 要点` via regex. New `## 信息图` section would be parsed here the same way (one fenced JSON block). |
| `apps/desktop/src/services/clipService.ts` | `generateClip` calls clips agent, expects pure JSON object `{title,tags,suggestedTags,summary,keyPoints}`. `saveClip` assembles markdown (frontmatter + `## 摘要` + `## 要点`). Infographic generation is a *separate, on-demand* flow that appends a `## 信息图` section to an existing clip file. |
| `apps/desktop/src/features/clips/.claude/agents/clips.md` | Clips agent output contract: pure JSON, no code fences, no prose. Same discipline must apply to the infographic agent. |
| `apps/desktop/src/features/clips/.claude/CLAUDE.md` | Clip doc structure: frontmatter + `## 摘要` + `## 要点`. A new `## 信息图` fenced JSON block follows the same sectioned-markdown convention. |
| `apps/desktop/src/components/graph/` | D3 force-directed wiki graph — the *heavy* viz path. Infographic deliberately avoids D3; uses Tailwind-only poster cards. |

Key constraints from the codebase:
- Renderer is React 18 + Tailwind 3 (no D3 layout engine for this).
- Feature-agent mechanism (`featureAgentService`) invokes the LLM; output must be **pure JSON, no code fences, no prose** (matches existing clips agent discipline — see `clips.md` line 15).
- Persisted into clip markdown under a `## 信息图` section as a fenced JSON codeblock (regex-parseable like the existing `## 摘要`/`## 要点` sections in `ClipCardView.parseClipContent`).
- Article already has `summary` + `keyPoints` from the clips agent; infographic agent receives those as input and must **not re-fetch the page**.

---

## Comparable Patterns

### 1. Notion Block API (reference for "flat ordered block list with typed blocks")

Notion's public API models a document as `results: Block[]` — a **flat ordered array**, not a tree (except for `has_children` which requires a separate fetch). Each block: `{ type, id, ...type-specific-fields }`.

Recurring block types and their payload fields (from Notion API docs):

| `type` | Key fields |
|---|---|
| `heading_1/2/3` | `rich_text: RichText[]` |
| `paragraph` | `rich_text`, `color` |
| `bulleted_list_item` / `numbered_list_item` | `rich_text` |
| `callout` | `rich_text`, `icon` (emoji) |
| `quote` | `rich_text` |
| `divider` | (none) |
| `image` | `file: { url, caption }` |
| `bookmark` | `url`, `caption` |
| `table` | `table_width`, `rows` |
| `column_list` / `column` | children → the only true "layout" primitive |

**Layout model**: flat ordered list. Multi-column layout is achieved by a single `column_list` block whose children are `column` blocks, each containing their own flat block list. This is the key insight: **layout is opt-in via a single wrapper block type, everything else is a flat vertical stack.**

**Why relevant**: This is the most battle-tested "LLM/editor produces structured blocks" schema in production. Flat-list-with-optional-column-wrapper is exactly the simplicity level an LLM can reliably emit.

### 2. Editor.js (reference for "one JSON object per block, tool-name as type")

Editor.js output format: `{ blocks: BlockData[] }` where each block is:

```json
{ "id": "...", "type": "paragraph", "data": { "text": "..." }, "tunes": { ... } }
```

`type` is a **tool name**; `data` is tool-specific. Default tools shipped:

| `type` | `data` fields |
|---|---|
| `paragraph` | `text` (HTML string) |
| `header` | `text`, `level` (1-6) |
| `list` | `style: "ordered"|"unordered"`, `items: string[]` |
| `quote` | `text`, `caption`, `alignment` |
| `warning` | `title`, `message` |
| `code` | `code` |
| `delimiter` | (none) — visual divider |
| `image` | `file.url`, `caption`, `withBorder`, `stretched`, `background` |
| `embed` | `service`, `source`, `embed`, `width`, `height`, `caption` |
| `table` | `content: string[][]` |
| `checklist` | `items: { text, checked }[]` |
| `raw` | `html` |

`tunes` is a side-channel for non-content meta (alignment, background) kept out of `data`.

**Layout model**: pure flat ordered array. No grid/column primitive at the block level — layout is a *render-time* concern (CSS) not a data concern. Block-level `stretched`/`withBorder` flags are the only layout hints, and they live in `tunes`/data, not a separate layout tree.

**Why relevant**: Editor.js explicitly chose flat-list + tool-name discriminator + `data` blob because it's the shape an editor (and by analogy an LLM) can emit reliably. The `tunes` split (content vs. presentation meta) is a good pattern for our case where we want the LLM to optionally hint at accent color / emphasis without bloating the content schema.

### 3. Lexical (reference for "node tree with type discriminator + flat serialization")

Lexical's internal model is a **tree** of `LexicalNode`s, each `{ type, key, ...format }`. But the commonly serialized form (for transport/import-export) flattens to a JSON node list. Headings: `{ type: "heading", tag: "h1"|"h2"|"h3", format, indent }`; list: `{ type: "list", listType: "number"|"bullet", start, format }` with `listitem` children; quote: `{ type: "quote" }`; image: `{ type: "image", src, alt, width }`.

**Layout model**: tree. Layout is implicit via parent-child nesting (lists contain list items; tables contain rows contain cells). There is **no grid/section primitive** — like Notion and Editor.js, Lexical punts multi-column layout to the renderer.

**Why relevant**: Lexical confirms the consensus — block editors treat layout as a render concern. The tree model is more expressive than flat-list but harder for an LLM to emit correctly (deep nesting, consistent parent keys). **For LLM output, flat-list wins.**

### 4. AI-infographic tools (Gamma / Napkin / "AI visual summary")

These are closed-source; their internal block specs aren't published. What's observable and documented from their behavior and public commentary:

- **Gamma**: LLM generates a markdown/structured outline (sections → cards → bullet points), then a separate "card layout" pass turns each section into a fixed set of card templates (title card, stat card, list card, quote card, image+caption card). The schema is effectively `{ sections: [{ type: "title"|"stat"|"list"|"quote"|"image", ...fields }] }` — flat per-card, with a `type` discriminator selecting a **server-side card template**. The lesson: separate "content block schema" (LLM-emitted) from "card template" (renderer-side), and let the renderer pick the visual template per block type.

- **Napkin**: takes a document and generates a structured visualization per *paragraph/section*, choosing from a small set of viz types (hierarchy tree, comparison columns, timeline, stat row, process flow, quote). Observable schema shape: each output viz is `{ kind: "hierarchy"|"comparison"|"timeline"|"stats"|"process"|"quote", items: [...] }`. The `kind` selects a viz template; `items` is a small homogeneous array.

- **Open-source "AI infographic" projects** (e.g. `aiformaps`, `chatgpt-to-notion` visual exports, Figma AI plugins): the recurring pattern is a small fixed enum of "infographic block types" — typically `hero/title`, `stat`/`kpi`, `timeline`, `comparison`, `flow`/`steps`, `quote`, `list`, `tags`. Each block is a flat object with a `type` + 2-4 content fields. None use a grid; all are vertical stacks with per-block self-contained layout.

**Recurring infographic block types across all sources** (this is the consensus set for article-summary infographics):

| Block kind | Always-present fields |
|---|---|
| hero / title | `title`, optional `subtitle`, optional `image`/`source` |
| stat / kpi | `value`, `label`, optional `unit`, optional `caption` |
| timeline | `items: [{ time, title, detail }]` |
| comparison | `columns: [{ title, items[] }]` (usually 2 cols) |
| steps / flow | `steps: [{ title, detail }]` (ordered) |
| quote | `text`, `author`/`source` |
| list (key points) | `items: string[]` or `items: [{ title, detail }]` |
| tags | `tags: string[]` |
| source / footer | `url`, `hostname`, `clipped` date |

---

## Recommended Block-Type Enumeration (tailored to article-summary)

A single enum, each block a flat object `{ type, ...fields }`. Fields are primitives (string / string[] / small object arrays) — no deep nesting, to keep LLM emission reliable.

```
type Block =
  | { type: "hero",     title: string, subtitle?: string }
  | { type: "stat",     items: { value: string, label: string, unit?: string }[] }   // 1-4 stats
  | { type: "keypoints",items: string[] }                                             // reuse clips keyPoints
  | { type: "timeline", items: { time: string, title: string, detail?: string }[] }
  | { type: "steps",    steps: { title: string, detail?: string }[] }                 // ordered flow
  | { type: "comparison", columns: { title: string, items: string[] }[] }             // 2-3 cols
  | { type: "quote",    text: string, source?: string }
  | { type: "tags",     tags: string[] }
  | { type: "source",   url: string, hostname?: string, clipped?: string }
```

Notes:
- `hero` is the poster header; reuses clip `title` but lets LLM write a punchier subtitle.
- `keypoints` lets the infographic reuse the existing `## 要点` directly without re-fetching.
- `stat` is the highest-value infographic-specific block (numbers pop visually); constrain `items` to 1-4 to keep the poster single-row.
- `comparison` columns capped at 2-3 to avoid Tailwind grid overflow.
- `source` block is the poster footer; mirrors the clip's frontmatter `url`/`clipped`.

## Recommended Layout Model: **flat ordered block list**

```json
{ "version": 1, "blocks": [ Block, Block, ... ] }
```

Rationale:
1. **LLM reliability**: a flat array is the simplest JSON an LLM can emit correctly. Tree/grid models invite inconsistent nesting depth and parent-key errors (the Lexical-tree failure mode). All three editor schemas (Notion, Editor.js, Lexical-serialized) confirm flat-list is the emitter-friendly choice; layout complexity is pushed to the renderer.
2. **Render simplicity**: React + Tailwind maps a flat `blocks.map(b => <BlockView type={b.type} {...b} />)` directly — no layout engine, no D3, no grid solver. Each block type is one self-contained Tailwind card section. Vertical stack with `space-y` is the default; multi-column (e.g. a stat row) is a *per-block-type* render decision (a `stat` block renders its `items` in a `grid grid-cols-2 md:grid-cols-4`), not a document-level layout concern.
3. **Persistence fit**: a flat `blocks` array serializes to one fenced JSON block under `## 信息图`, parsed by the same regex style `ClipCardView` already uses for `## 摘要`/`## 要点`.
4. **No grid/section wrapper**: deliberately reject a `section { columns: [...], blocks: [...] }` tree. If multi-column is ever needed, add a single `columns` block type later whose `items` are block arrays — the Notion `column_list` pattern — rather than wrapping the whole doc in a layout tree now.

Alternative considered: **grid/sections tree** (`{ sections: [{ layout: "2col", blocks: [...] }] }`) — more expressive, but the LLM must now decide both content *and* layout simultaneously, which empirically degrades JSON validity and isn't needed for a single-column poster.

## Pitfalls

- **LLM JSON validity**: LLMs love to wrap output in ``` fences or add prose. The existing clips agent already fights this (`clips.md` lines 14-16: "只输出一个 JSON 对象, 不要包裹在代码块里"). The infographic agent prompt must repeat this discipline verbatim, and `clipService`'s `aiText.match(/\{[\s\S]*\}/)` extraction (line 87) should be reused as a defensive parser.
- **Enum drift / unknown types**: LLM may emit `type: "heading"` instead of `hero`, or invent new types. Renderer must `switch` on `type` with a **default fallback** (render as plain text or skip), never throw. Validate against the enum in TS; log unknown types.
- **Field-length blowup**: an LLM may put a paragraph in a `stat.label`. Constrain in-prompt ("value max 8 chars, label max 20 chars") and have the renderer `truncate` with CSS.
- **i18n (zh/en)**: clip tags/summary follow page language (`clips.md` line 29). Infographic text should inherit the same language. Don't hardcode section labels ("要点"/"Key Points") in the schema — let the renderer pick labels by locale, or include a top-level `lang: "zh"|"en"` field so the renderer picks label strings. Numeric `stat.value` is locale-safe; `timeline.time` should be a free string (not a parsed date) to avoid locale date parsing.
- **Re-fetch avoidance**: the infographic agent must take `summary` + `keyPoints` + `title` + `url` as input (already in the clip file) and must NOT WebFetch the URL. Configure the agent's `tools:` line to exclude WebFetch (clips agent has `tools: WebFetch, WebSearch, Read`; infographic agent should have `tools: Read` only).
- **Re-render determinism**: fenced JSON in markdown means re-opening the clip must re-render identically. Avoid any block field that's a render-time computation (e.g. "colorIndex") — colors are renderer-decided by block type, not LLM-decided, so re-renders are stable.
- **Over-generation**: an LLM may emit 15 blocks. Cap in-prompt to "5-9 blocks" and have the renderer warn/truncate beyond 12.

## Caveats / Not Found

- Gamma and Napkin internal schemas are closed-source; descriptions above are inferred from observable behavior and public commentary, not official specs. Treat as "pattern guidance", not authoritative field names.
- Network access was restricted during this research session, so I could not fetch live Editor.js/Lexical/Notion type definition files to quote exact current field names verbatim. The field names above are from stable, long-documented versions of these APIs (Notion Block API v1, Editor.js ~2.x, Lexical stable) and are reliable as pattern references, but verify exact field casing against current docs before pinning a TS type.
- No existing infographic/block-JSON code found inside this repo (clips agent emits flat metadata, not blocks); this is a greenfield schema.
