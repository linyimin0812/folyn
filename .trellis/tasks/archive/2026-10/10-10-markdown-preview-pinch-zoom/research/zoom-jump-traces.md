# Research: WebKit CSS-zoom scroll-compensation model (content jumps)

- **Query**: correct scroll-compensation model for CSS `zoom` on `.md-preview` in WKWebView; why content still jumps despite per-frame rAF anchor compensation
- **Scope**: mixed (repro experiment, Playwright WebKit + Chromium)
- **Date**: 2026-10-11
- **Repro**: `zoom-jump-repro.html` (faithful structure: `.prev-body` 400px scroll container, `padding 8px 32px 100vh`, `.md-preview` `zoom: var(--md-zoom,1); max-width:800px; margin:0 auto; font-size:14px; line-height:1.6`, ~40 mixed EN/ZH paragraphs, sentinel at para 21, 30-frame ease-out 1→1.5, `compensateScroll(top, 200, ratio)` identical to `usePreviewZoom.frame`)
- **Driver**: `zoom-jump-driver.mjs` (Playwright from `/tmp/webkit-bisect`, viewport 900x700) → raw traces in `zoom-jump-results.json`; geometry evidence in `geometry-probe.mjs`

## TL;DR verdict

**The ratio model `(scrollTop + anchor)·ratio − anchor` is structurally wrong for this layout, in every engine.** CSS `zoom` shrinks `.md-preview`'s effective column width (`availableViewport / z` in content coordinates), so `max-width:800px` stops binding at `z ≈ paneAvail/800` (≈1.045 in the repro) and **text reflows continuously as z changes, in discrete line-wrap steps**. Content height grows superlinearly (1478px → 3225px for 1.5x in WebKit = 2.18x, not 1.5x) and lurches by whole line heights. Ratio compensation assumes height scales exactly with `ratio` → systematic under-compensation → the content jumps.

**The engine never fights us.** WebKit/Chromium keep `scrollTop` untouched on zoom change (verified below). The jump is pure under-compensation.

**The only jump-free model is measurement-based anchor-node pinning (V-E)**: per frame, write the zoom, then correct `scrollTop` by the *measured* movement of the DOM node under the anchor point. Max frame-to-frame sentinel delta ≤2.4px in both engines, both zoom directions (vs 92.9–172.7px for the current model).

## Findings

### 1. Root cause: zoom → column narrowing → discrete reflow

Geometry probe (`geometry-probe.mjs`, WebKit, pane avail width 836px, scrollTop fixed 609):

| z | scrollHeight | md box (viewport px) | md content width (px) | first-p para height | sentinel visual Y |
|---|---|---|---|---|---|
| 1.0 | 2214 | 800 (max-width binds) | 800 | 22.39 (1 line) | 140.8 |
| 1.05 | 2288 | **836 (fills pane)** | 796 | 23.48 | 177.1 |
| 1.2 | 2515 | 836 | 697 | 26.88 (1 line) | 289.2 |
| 1.3 | 2927 | 836 | 643 | 29.09 | 479.2 |
| 1.4 | 3412 | 836 | 597 | 31.34 (1 line) | 719.4 |
| 1.5 | 3975 | 836 | 557 | **67.19 (2 lines — reflow jump)** | 1015.8 |

Chromium shows the same (first para rewraps one step earlier). Mechanism, confirmed by the numbers:

- Standardized CSS `zoom`: the zoomed element lays out in its own coordinate space; available width from the parent is divided by z. Box (viewport px) = `min(800·z, paneAvail)`.
- Once `800·z > paneAvail`, the box fills the pane and its **content** column narrows as `paneAvail / z` (836 → 557 content px at z=1.5 ≈ 30% narrower) → more wrapped lines → height grows ~`z · (800/columnWidth)`.
- Line wraps change **discretely** as the column narrows: height jumps by whole line heights between z values (e.g. first paragraph 1 line → 2 lines). This is the visible "content jump"; it is not proportional to the frame's zoom delta, so ratio-based compensation cannot track it.

Consequence for the real app: in split mode the pane is narrower than 800, so `.md-preview` is already pane-width at z=1 — **every zoom gesture reflows from the first frame**. In wide panes reflow starts at `z > paneAvail/800`. Side observation: zoom-in also visually widens the text column to fill the pane (a `max-width` + `zoom` interaction, independent of the scroll model).

Per-frame V-A (current app model) sentinel deltas, WebKit, zoom 1→1.5 — the lurch signature (calm frames, then single-frame jumps):

```
[-2.9, -1.5, -2.0, -2.6, +26.7, +57.1, +29.8, +30.9, +92.9, +3.5, +2.7, +34.0, +2.6, +66.9, +34.5, +35.1, +36.2, +34.8, +3.4, 0.6, ...]
```

Smooth while the column is still 800 (z<1.045, frames 0–4 ≈ −3px/frame = correct design drift), then line-wrap lurches begin. Not a jump-then-revert pattern — monotonic drift with embedded single-frame lurches.

### 2. Per-variant trace summary (max |frame-to-frame Δ sentinel visual Y|, 30 frames, 1→1.5)

| Variant | WebKit | Chromium | Notes |
|---|---|---|---|
| **V-A** per-frame ratio compensation, `overflow-anchor:none` (current app) | **92.9px** (net drift +491px) | **153.7px** (net +574px) | jumps; WebKit read-back rounds ≤1px on 16/30 frames |
| **V-D** V-A with engine anchoring on (no `overflow-anchor` rule) | 92.9px — **identical trace to V-A** | 153.7px — identical | our own scrollTop writes make anchoring irrelevant |
| **V-B** no scrollTop writes | 110.9px (net +839px) | 172.7px (net +940px) | pure drift |
| **V-B2** no writes, anchoring ON | **34.8px (net +167px)** — WebKit native scroll anchoring partially engages | 172.7px — **identical to V-B**, Chromium anchoring never fires for zoom-driven layout | neither engine's anchoring is sufficient alone |
| **V-C** single final scrollTop write | 110.9px during animation (worst UX: full drift then a snap) | 172.7px | rejected |
| **V-E** measured anchor-node pinning | **1.5px** (net −1.7px) | **1.6px** (net −17.9px) | **jump-free** |
| V-E zoom-out 1.5→1 | **2.4px** (net +30px) | 1.8px | jump-free both directions |
| V-A zoom-out 1.5→1 | 88.6px | 172.5px | jumps both directions |

V-E detail (WebKit): anchor node = the `<p>` under viewport center; its own visual Y max frame delta 0.9px (zoom-in) / 1.0px (zoom-out). Residual ≤2.4px sentinel wobble is WebKit's integer-ish scrollTop rounding (≤1px per write), imperceptible. Content *far* from the anchor still lurches when lines between it and the anchor rewrap — inherent to reflow, no scroll model can remove it; what matters is that the point under the user's cursor/fingers is continuous.

### 3. Direct questions asked

**Does WebKit adjust scrollTop when zoom changes (single step 1→1.5 @ scrollTop=300)?**
No. `before=300, raw=300, afterLayout=300, nextFrame=300` — WebKit and Chromium both **keep** scrollTop exactly (no rescale, no clamp; extent only grows on zoom-in). Sentinel content offset went 749.8 → 1624.8 (2.17x, reflow).

**Does the engine mutate scrollTop between our rAF frames?**
No — 0/29 frames in every variant, both engines, both directions (`next-frame pre-read == previous post-write`, exactly). There is **no engine-side scroll adjustment fighting the hook**. (The earlier "WebKit scroll anchoring fight" hypothesis is dead: with per-frame manual writes, `overflow-anchor: none` vs on changes *nothing* — traces byte-identical in both engines.)

**Same-callback read-back after writing `--md-zoom` + `scrollTop`:**
Chromium: exact. WebKit: rounds/clamps by ≤1px on ~half the frames (sub-pixel, harmless). No large clamps once scrollTop stays within the live extent.

**Measurement validity:** `getBoundingClientRect` inside the zoomed subtree returns true viewport coordinates in both engines (fixed-height marker 100px → 125px → 150px at z=1/1.25/1.5; sentinel height 22.39 → 33.59). But `document.elementFromPoint` **is unreliable inside zoomed subtrees in WebKit** (returned the container `.md-preview` instead of a `<p>`) — anchor-node selection must walk `getBoundingClientRect`, not hit-test.

## Recommended scroll model for `usePreviewZoom` (V-E)

Replace the ratio formula in `frame()` with measured pinning:

1. On gesture start (`startZoom`), pick the anchor node once: walk the scroller's descendant block elements and keep the last one whose `getBoundingClientRect().top <= anchorViewportY` (cheap: binary search over `.md-preview` children, or cache the element list). Do not use `elementFromPoint` (WebKit zoom hit-test bug).
2. Per rAF frame:
   ```ts
   const pre = anchorNode.getBoundingClientRect().top;   // old layout
   el.style.setProperty('--md-zoom', String(next));
   const post = anchorNode.getBoundingClientRect().top; // forces layout with new zoom
   el.scrollTop += post - pre;                           // pin the node exactly
   ```
   (horizontal: same with `.left` and `anchorNode` under the anchor X, or skip — the column is centered so horizontal compensation is mostly cosmetic)
3. To kill the ≤1px/frame rounding drift, pin to the stored absolute target: `el.scrollTop += (scrollerRect.top + anchorY) - post` instead of `post - pre` (equivalent, self-correcting).
4. Guard: if `anchorNode.isConnected` becomes false (React re-rendered the preview), re-pick from current scroll geometry before continuing.
5. Cost: one forced layout per frame — the current code already forces layout every frame via its rect reads; no regression.

Edge cases kept in mind: near the document top/bottom the write clamps to the extent (same as today); the anchor point stays continuous regardless.

## Caveats / not tested

- The repro's lurch magnitudes depend on viewport width (900px) and text; the real app's pane width changes the reflow threshold (`z > paneAvail/800`) but not the mechanism.
- Playwright WebKit ≈ WKWebView but not identical build; the engine-behavior answers (no scrollTop mutation, rect validity, elementFromPoint bug) are basic architecture and very unlikely to differ.
- `transform: scale` alternative (no reflow at all) out of scope.
- V-E with the anchor at a finger position (pinch) vs viewport center (keyboard) — only center tested; the model is anchor-position-agnostic.

## Files

| File | Description |
|---|---|
| `zoom-jump-repro.html` | self-contained repro, `?variant=A|B|C|E&anchor=none|default&dir=in|out` |
| `zoom-jump-driver.mjs` | Playwright driver, all variants, prints summary, writes JSON |
| `zoom-jump-results.json` | full per-frame traces, both engines |
| `geometry-probe.mjs` | scrollHeight/box-width/para-height vs z probe (root-cause evidence) |
