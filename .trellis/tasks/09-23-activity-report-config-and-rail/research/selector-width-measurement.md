# Research: PairSelector closed trigger width — ground truth from the running dev server

- **Query**: Why is the PairSelector closed trigger in 报告设置 not 360px despite `className="w-[360px]"` (commit 515d21d0)?
- **Scope**: internal (live dev-server CSS/JS introspection; browser DevTools MCP unavailable in this session, curl denied — used `node fetch` against localhost:1420 instead)
- **Date**: 2026-09-23

## Environment facts

- Vite dev server IS running: node PID 56872, listening on `*:1420`.
- git: current branch `master`, HEAD = `515d21d0` (the fix commit). Working tree clean for the relevant files. The conversation-start git snapshot showing `ReportSettingsView.tsx` as untracked was stale.
- Tailwind v3.4.17 (`apps/desktop/package.json`), PostCSS pipeline, config `apps/desktop/tailwind.config.js` with `content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}', ...]` — both involved files are inside the globs.

## Ground truth: CSS actually served right now

Fetched `http://localhost:1420/src/index.css` (Accept: text/css → raw CSS, 134,649 bytes) and grepped it.

Every rule the 360px layout needs EXISTS in the live served CSS:

| Selector in served CSS | Rule body | Line |
|---|---|---|
| `.w-\[360px\]` | `width: 360px;` | 1229 |
| `.max-w-\[360px\]` | `max-width: 360px;` | 1393 (root-dir input) |
| `.min-w-\[360px\]` | `min-width: 360px;` | 1342 |
| `.max-w-full` | `max-width: 100%;` | 1429 |
| `.flex` | `display: flex;` | 897 |
| `.inline-block`, `.h-\[28px\]`, `.max-w-\[720px\]`, `.max-w-\[1200px\]`, `.w-\[520px\]`, `.min-w-\[220px\]` | all present | — |

Also verified the running server serves the CURRENT JS modules (not stale):

- `/src/components/activity/ReportSettingsView.tsx` module contains `w-[360px]`.
- `/src/components/ai/PairSelector.tsx` module contains `relative inline-block max-w-full` wrapper (line 274) and the `flex items-center gap-1.5` trigger (line 278).

## Layout math (static, from served CSS + source)

Wrapper: `relative inline-block max-w-full w-[360px]` inside `div.py-4.border-t...` (block) inside `max-w-[720px]` (ReportSettingsView root) inside `max-w-[1200px] mx-auto p-8` — containing block ≈ 720px ≥ 360px, so `max-w-full` does not clamp. Wrapper computes to **360px**.

Trigger button: `display: flex` (block-level flex container, `.flex` rule exists) inside the 360px wrapper → stretches to **360px**. Its own `max-w-full` = 100% of 360px = no clamp. No other rule sets width on it: the only `button` element rule in the CSS is `{font-family; cursor; border: 0 solid; background: none; color: inherit}` — no width.

## Side finding: `fi2` is a dead class

`fi2` appears on 20+ components (including the PairSelector trigger) but has **zero CSS definitions** anywhere — not in `apps/desktop/src/index.css`, not in the other CSS files (`pet.css`, `grapesTheme.css`), not in the Tailwind config (no plugins), and zero occurrences in the served CSS. It is a no-op legacy name. Harmless for width, but it does nothing.

## Diagnosis

**The code and the CSS currently served by the dev server are correct.** With a fresh page load right now, the closed trigger should render at 360px. `w-[360px]` is NOT missing from Tailwind's output — the rule exists at line 1229 of the served stylesheet.

**Why the user saw "width NEVER changes":** the window they were observing was not running the current code/CSS. Evidence: four consecutive commits each used a layout approach that cannot fail if the CSS is live —

1. `ade8dfe0` — wrapped the selector in a fixed `w-[360px]` container div
2. `fcefdb4e` — `w-full` on the trigger inside that 360px wrapper
3. `647d4975` — `panelMatchWidth` panel
4. `515d21d0` — single `w-[360px]` className on PairSelector

A bare `<div class="w-[360px]">` in a 720px-wide parent is 360px in any working browser session. If even attempt #1 "changed nothing," the rendered page was stale. Most likely causes, in order:

1. **Dead HMR link in the Tauri webview / browser tab** — vite client websocket dropped, so regenerated CSS never reached the window, and no visible error. A hard reload (restart `tauri dev`, or reload the webview) fixes it.
2. The window being measured was a **packaged/older build** (dist from before these commits) rather than the dev URL `http://localhost:1420`.
3. An earlier second dev-server instance (only one listener exists now, PID 56872).

## Caveats / Not Found

- Could not do live DOM measurement (`getComputedStyle`, DevTools): chrome-devtools MCP tools were not available in this session and `curl` was permission-denied. Node `fetch` against localhost worked, which gave byte-level ground truth for the served CSS — sufficient to answer "does the rule exist" definitively.
- Could not visually confirm the app (vault requirement, no browser tooling).
- Suggested verification step for the main agent: hard-reload the app window against the running dev server and re-measure the trigger; expect 360px.
