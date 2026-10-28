# UI verification — 2026-10-25

## Automated

- TopicReader + AskView: 8 targeted regression tests passed (implementation and independent check).
- Existing retrievalLoop + sourceStatus: 17 tests passed; these establish existing behavior only, not full requirements compliance.
- TypeScript transpile syntax checks on knowledge UI files: no syntax errors. Full semantic project typecheck/build intentionally not run per project instructions.

## Browser

Actual React workbench/sidebar components rendered in an isolated Vite fixture outside the repo, with simulated stores/files/model responses. No production vault writes or model calls.

- Topic overview -> selected topic -> citation evidence verified.
- Matching H1 appears once; unordered/ordered list markers visible.
- Desktop 1280px: workbench splits reader/evidence horizontally; evidence width 320px.
- 900px window / 704px work area: evidence moves below reader, both sections remain within the visible area.
- 620px window / 424px work area: source rows and review comparisons wrap without page horizontal overflow; question input/results verified.
- Light/dark theme tokens verified. Sidebar summary/actions stay at bottom.
- Screenshot: /Users/yiminlin/.codex/visualizations/2026/10/24/01a16dbd-7233-72c0-b51d-3d0b3d1883dd/folyn-knowledge-ui-implemented.jpg

## Limits

Folyn native app was not running. Native app end-to-end testing with real vault data remains unverified. Existing service/store changes belong to prior implementation and were not modified by this UI task. No commits made; user review of the working-tree result remains pending.

## Intake interaction follow-up

User explicitly prioritized source intake, generation and updating. Deferred editor-return/read-position changes.

- Added 13 source-flow regressions; combined SourcesView/TopicReader/AskView run: 21 tests passed.
- Independent review caught save-time custom-toggle changes and missing source-specific review links; both fixed and covered.
- Actual-component browser fixture verified direct settings entry, draft cancellation, Add/search/select/count, Save only (no build), Save and organize (progress to result), related topic and review buttons. Services/files/model remain simulated in this fixture.
- Intake screenshots: `folyn-knowledge-intake-selection.jpg`, `folyn-knowledge-intake-results.jpg` under the existing task visualization directory.
- No native Vault/model end-to-end verification; no full build/typecheck. No commits.

## Scope picker visual follow-up

- Refined only ScopePicker.tsx and local ScopePicker.css: integrated search/clear, file/folder icons, native checkbox with custom visual/partial state, hierarchy, type/inheritance metadata, explicit-range footer, themed surfaces and responsive rows.
- Existing 13 source-flow tests passed; TSX syntax and diff checks passed. No style-class assertion tests added.
- Actual component browser check: directory partial state, selected file, unsupported PDF, nested directory rows, empty search, clear search, light/dark; 620px window picker/list width 360px and no horizontal overflow.
- Screenshot: folyn-scope-picker-light.jpg (actual component, simulated file list).
