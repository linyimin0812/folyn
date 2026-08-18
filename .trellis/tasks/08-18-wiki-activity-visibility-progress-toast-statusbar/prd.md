# Wiki Activity Visibility — Progress, Toast, Status Bar

## Goal

Make wiki background operations (ingest / lint / query) visible to the user. Currently the pipeline runs but the UI barely echoes back — ingest especially is invisible until the file tree refreshes.

## What I already know (from repo inspection)

- `wikiStore` already holds: `activityLog` (capped 100 entries), `currentIngestStep: 1 | 2 | null`, `ingestProgress: string`, `isIngesting`, `isLinting` — state exists, no UI surfaces most of it.
- `WikiFileTree` has sub-tabs Files | Reviews; no progress strip (PRD E1 said "WikiFileTree 底部进度区" — I shipped sub-tabs but dropped the progress strip).
- `WikiQueryView` has a transient progress line at the bottom (only visible while running); no history persistence.
- `StatusBar.tsx` (`components/shell/`) — single footer, vault name left + tab/view/cursor/wordcount right. No wiki indicator.
- Toast infra: `.sw-toast` CSS exists in `index.css`; only `schedule/Toast.tsx` uses it (reads `scheduleStore.toastMsg` + `toastAction`). No generic toast store.
- Vault switch already filters out `wiki-query` / `wiki-graph` tabs (`isExternalPath` false → dropped).

## Requirements (evolving)

1. **Ingest progress panel** — WikiFileTree bottom strip showing `currentIngestStep` + `ingestProgress` + last N `activityLog` entries. Fades 2s after `isIngesting` flips false.
2. **Query tab history persistence** — decide: per-tab-session only (current) vs persisted across tab close/reopen.
3. **Lint completion toast** — when auto-lint finishes after ingest, surface a toast with new-review-count + "View" action jumping to Reviews sub-tab.
4. **Status bar wiki indicator** — left side of `StatusBar`, icon + brief status ("ingesting 2/5", "lint running", "query running", or hidden when idle).

## Acceptance Criteria

- [ ] Ingest: starting an ingest shows step + progress in WikiFileTree bottom within 100ms; activity log entries stream in
- [ ] Lint completion: toast appears within 500ms of `runStructuralLintService` finishing; "View" jumps to Reviews sub-tab
- [ ] Status bar: shows wiki indicator while any of `isIngesting` / `isLinting` / wiki-query running is true; hidden when idle
- [ ] Query history: behavior matches chosen option (Q1 below)

## Open Questions

- [x] Q1: Toast system approach — generic `toastStore` + `<ToastHost/>` (option 1)
- [x] Q2: Query history persistence — option 3: persist per-vault + bind sessionId to vault (mirror aiStore.switchVaultSessions)

## Out of Scope

- Concurrent ingest mutex (deferred from prior PRD)
- Ingest cancel button (deferred from prior PRD)
- NotificationsSettings integration (system-level notifications, not in-app toasts)

## Technical Notes

- Files likely touched: `components/sidebar/WikiFileTree.tsx`, `components/shell/StatusBar.tsx`, `services/wikiLintService.ts` (toast call), `store/wikiStore.ts` (selector helpers), new `store/toastStore.ts` (if generic toast path), `components/wiki/WikiQueryView.tsx` (history persistence).
- Reuse `.sw-toast` CSS class — already styled.
