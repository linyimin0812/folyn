# AnalysisPanel Open Slow and Freeze

## Goal

Investigate and fix the performance issue where the 「项目分析」 sidebar panel opens very slowly and after opening, the page freezes (operations don't respond). Main-thread-blocking symptom suggests either a heavy synchronous loop, a huge re-render, or a blocking IPC call.

## What I already know

- The panel is `apps/desktop/src/components/sidebar/AnalysisPanel.tsx`.
- On mount, it calls `loadReports()` from `useAnalysisStore`.
- Reports are HTML files; metadata (`ReportMeta`) is loaded from the filesystem via Tauri.
- Each report renders as a `ReportCard` with an `onClick` that calls `openFile(report.path, report.name)`.
- The user reports the symptom is on panel open (not on report open).

## Assumptions (to validate)

- `loadReports()` does a heavy synchronous operation (e.g. reading many HTML files from disk and parsing metadata).
- Or the panel renders many reports without virtualization, causing a long layout/paint.
- Or a `useEffect`/`useMemo` dependency triggers repeated work.
- Or Tauri IPC calls are awaited synchronously on the main thread, blocking paint.

## Open Questions

- How many reports does the user have? (Could be hundreds → list virtualization needed.)
- Is the freeze on first open only, or every open?
- Does the freeze clear after a few seconds, or persist until reload?

## Requirements (evolving)

- Identify the root cause of the open-time freeze via profiling / code inspection.
- Apply a fix that makes panel open return to interactive within a reasonable time (<500ms for ~100 reports).
- No regression in report list correctness (tags, grouping, delete).

## Acceptance Criteria (evolving)

- [ ] Root cause identified and documented in PRD.
- [ ] Panel opens without freezing the main thread.
- [ ] Existing tests still pass.

## Definition of Done

- Tests added/updated for the fix.
- Lint / typecheck / vitest green.
- Manual smoke test in the desktop app confirms panel opens smoothly.

## Out of Scope (explicit)

- Performance of generating a new analysis (that's a backend/AI task).
- Performance of opening a single report file (separate concern).
- GrapesJS canvas centering (separate task: `06-26-grapeseditor-canvas-center-and-hide-scrollbar`, paused).

## Technical Notes

- Files to inspect:
  - `apps/desktop/src/components/sidebar/AnalysisPanel.tsx`
  - `apps/desktop/src/store/analysisStore.ts`
  - `apps/desktop/src/services/githubAnalysisService.ts`
  - Any Tauri IPC layer that reads report files from disk
- Related: `.trellis/spec/desktop/frontend/state-management.md` (Zustand store patterns)
