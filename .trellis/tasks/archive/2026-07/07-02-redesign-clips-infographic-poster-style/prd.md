# redesign clips infographic to poster-style

## Goal

Redesign CLIPS infographic into a true poster-style image: content-rich (一图胜千言), unified poster visual (not a card stack), and exportable as a PNG file. Current output is content-thin, visually poor, card-stack-style — user wants a real poster that conveys the article's core content at a glance.

## Requirements

### Content enrichment
- At `saveClip` time, store the full page markdown (fetched via curl.md at card-gen time) under a new `## 正文` section in the clip file, after `## 要点`.
- `generateClip` returns `pageContent: string` field (the curl.md markdown) in `ClipMetadata`; `saveClip` writes it to `## 正文`.
- `generateInfographic` passes `## 正文` (or full clip content) to the infographic agent so it has real source material to build 7-9 dense blocks.
- For existing clips without `## 正文`: infographic agent falls back to summary + keyPoints (current behavior). User can re-clip to get `## 正文`.
- Update `clips.md` agent contract: infographic-mode now expects `## 正文` from the clip file (agent uses Read on the clip path), produces 7-9 blocks minimum, must include `hero` + `stat` (if numbers present) + `keypoints` + `source` + 3-4 content blocks (timeline/steps/comparison/quote/tags).

### Section ordering
- `## 信息图` must be placed BEFORE `## 摘要` in the clip file (user sees poster first, then summary/keypoints/正文).
- New clip file section order: front-matter → `> **来源**` quote → `## 信息图` (if present) → `## 摘要` → `## 要点` → `## 正文`.
- `saveClip` does NOT write `## 信息图` (generated on-demand later); it writes `## 摘要` / `## 要点` / `## 正文`.
- `generateInfographic` writes/replaces `## 信息图` and must insert at the top position (right after `> **来源**` quote line, before `## 摘要`). For existing clips with `## 信息图` at the bottom: regenerate moves it to the top.
- `parseClipContent` must be order-agnostic (find sections by heading, not by position) so old clips with `## 信息图` at the end still parse correctly.

### Renderer redesign
- `InfographicView.tsx`: replace per-block `Section` cards with a unified poster container.
- Single poster container: fixed max-width ~800px, single background (`bg-panel` with subtle gradient or accent band), vertical stack inside.
- Hero: full-width header with accent band + title + subtitle (current hero style is OK, polish only).
- Stats: full-width row (4-col grid).
- Middle blocks: 2-column where appropriate (e.g. keypoints left + timeline/comparison right), full-width for quote/steps/tags.
- Source: full-width footer with hostname + url + clipped.
- Keep all 9 block types; restyle each to fit unified poster aesthetic (denser, less rounded, no per-block shadow).
- Responsive: poster width scales on small screens but design target is desktop.

### Image export
- Add `html-to-image ^1.11.13` dependency to `apps/desktop/package.json`.
- Add "导出为图片" button in `ClipCardView.tsx` infographic section header, next to "重新生成".
- Use `html-to-image.toPng()` on the poster container DOM node.
- Save via `@tauri-apps/plugin-dialog` `save()` dialog + `@tauri-apps/plugin-fs` `writeTextFile()`.
- Default filename: `<slug>-infographic.png`, default location: Downloads dir.
- Loading state on button during export; error toast on failure (e.g. font/CORS issue).

## Acceptance Criteria

- [ ] `saveClip` writes `## 正文` section with full page markdown to clip file (after `## 要点`)
- [ ] `generateClip` returns `pageContent` field in `ClipMetadata`
- [ ] `generateInfographic` passes `## 正文` content to agent; agent produces 7-9 blocks with real content (not generic placeholders)
- [ ] `generateInfographic` writes `## 信息图` at the TOP position (right after `> **来源**` quote, before `## 摘要`) — both for new insertions and for replacements that move an existing bottom `## 信息图` to the top
- [ ] Existing clips without `## 正文` still work (fallback to summary + keyPoints); UI shows hint suggesting re-clip for richer infographic
- [ ] `parseClipContent` is order-agnostic — finds `## 信息图` / `## 摘要` / `## 要点` / `## 正文` by heading regardless of position, so old clips with `## 信息图` at the end still parse
- [ ] `InfographicView` renders as a single unified poster (one container, one background), not a vertical stack of separate cards
- [ ] All 9 block types still render correctly (hero/stat/keypoints/timeline/steps/comparison/quote/tags/source)
- [ ] "导出为图片" button produces a PNG file via native save dialog
- [ ] Exported PNG visually matches the on-screen poster (colors, fonts, layout)
- [ ] Export handles failure gracefully (loading state, error toast, no crash)
- [ ] `clips.md` agent contract updated for infographic-mode (`## 正文` input, 7-9 block minimum, content density guidance)
- [ ] `InfographicView.test.tsx` updated for new poster layout
- [ ] `clipService.test.ts` covers `pageContent` storage
- [ ] `clipParse.test.ts` covers `## 正文` parsing
- [ ] `tsc -b` clean; existing tests pass (except pre-existing env-only failures)

## Definition of Done

- Tests added/updated for: `saveClip` (pageContent), `parseClipContent` (## 正文), `InfographicView` (poster layout), export button interaction
- Lint / typecheck / CI green
- Spec `.trellis/spec/desktop/frontend/feature-agents.md` updated with `## 正文` storage + infographic content enrichment rule
- New spec section or file for poster-style renderer pattern (if reusable)
- Manual smoke test: clip a page → generate infographic → export PNG → visually verify
- No regression for existing clips without `## 正文` (fallback path)

## Technical Approach

**Content flow**:
```
generateClip (agent WebFetches curl.md → JSON metadata + pageContent field)
  ↓
saveClip (writes ## 摘要 / ## 要点 / ## 正文 / [## 信息图] sections)
  ↓
generateInfographic (reads clip file → passes ## 正文 to agent → agent outputs blocks JSON → writes ## 信息图)
  ↓
InfographicView (renders blocks as unified poster)
  ↓
"导出为图片" button (html-to-image.toPng → Tauri save dialog → writeTextFile)
```

**Renderer structure** (replaces current `flex flex-col gap-3` of separate `Section` cards):
```tsx
<div className="poster-container max-w-[800px] bg-panel rounded-2xl overflow-hidden border border-brd shadow-lg">
  <HeroBlock /> {/* full-width accent band + title */}
  <div className="poster-body px-6 py-5 flex flex-col gap-4">
    <StatBlock /> {/* full-width row */}
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <KeyPointsBlock />
      <TimelineBlock />
    </div>
    <StepsBlock /> {/* full-width */}
    <ComparisonBlock /> {/* full-width */}
    <QuoteBlock />
    <TagsBlock />
  </div>
  <SourceBlock /> {/* full-width footer */}
</div>
```

**Export flow**:
```tsx
const dataUrl = await htmlToImage.toPng(posterRef.current, { pixelRatio: 2 });
const bytes = Uint8Array.from(atob(dataUrl.split(',')[1]), c => c.charCodeAt(0));
const path = await save({ defaultPath: `${slug}-infographic.png`, filters: [{ name: 'PNG', extensions: ['png'] }] });
if (path) await writeBinaryFile(path, bytes);
```

## Decision (ADR-lite)

**Context**: User reported current infographic is content-thin, visually poor, card-stack-style. Wanted poster-style image with real information value.

**Decision**:
1. Store full page markdown in `## 正文` section (offline-safe, dead-link-safe).
2. Redesign renderer as unified poster container (not per-block cards).
3. Add PNG export via `html-to-image` + Tauri save dialog.

**Consequences**:
- Clip file format gains `## 正文` section — backward compatible (old clips just lack it, infographic falls back).
- `ClipMetadata` interface gains `pageContent` field — breaking change for any external consumer, but all consumers are in-repo.
- New dep `html-to-image` (~315KB).
- Existing clips need re-clip to get rich infographics — acceptable, no auto-migration.

## Out of Scope

- Auto-migration of existing clip files to add `## 正文` (user can re-clip manually)
- SVG export (PNG only for MVP)
- Animated/video infographic
- Poster templates / user-selectable themes (single default design)
- Applying the same content-enrichment pattern to other features (study/schedule)
- Editing the poster (export-only; no in-app poster editor)

## Technical Notes

- Files to edit:
  - `apps/desktop/src/services/clipService.ts` — `ClipMetadata.pageContent`, `saveClip` writes `## 正文`, `generateInfographic` reads `## 正文` and passes to agent
  - `apps/desktop/src/features/clips/clipParse.ts` — parse `## 正文` section
  - `apps/desktop/src/features/clips/.claude/agents/clips.md` — infographic-mode contract: `## 正文` input, 7-9 block minimum
  - `apps/desktop/src/components/file-types/clip/InfographicView.tsx` — full poster redesign
  - `apps/desktop/src/components/file-types/clip/ClipCardView.tsx` — add "导出为图片" button
  - `apps/desktop/src/store/clipStore.ts` — `exportInfographic` action (or inline in ClipCardView)
  - `apps/desktop/package.json` — add `html-to-image` dep
- Files to add:
  - `apps/desktop/src/components/file-types/clip/InfographicExport.ts` (or inline) — export-to-PNG helper
- Tests:
  - `apps/desktop/src/services/clipService.test.ts`
  - `apps/desktop/src/features/clips/clipParse.test.ts`
  - `apps/desktop/src/components/file-types/clip/InfographicView.test.tsx`
  - `apps/desktop/src/components/file-types/clip/ClipCardView.test.tsx` (export button)
- Spec: `.trellis/spec/desktop/frontend/feature-agents.md` — add `## 正文` storage + infographic content rule
- Research: [`research/html-to-image-library.md`](research/html-to-image-library.md) — recommends `html-to-image ^1.11.13`

## Implementation Plan (small PRs)

- **PR1**: Content enrichment — `ClipMetadata.pageContent` + `saveClip` writes `## 正文` + `clipParse` reads `## 正文` + `clips.md` contract update + tests
- **PR2**: Renderer redesign — `InfographicView.tsx` unified poster container + block restyle + test updates
- **PR3**: Image export — `html-to-image` dep + "导出为图片" button + Tauri save dialog integration + spec update

(Will likely ship as one commit since the task is bounded, but PRs show the logical sequence.)
