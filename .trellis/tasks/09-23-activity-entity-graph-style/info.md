# Design review notes

The previous graph used full pastel fills, 128px circular center nodes, window-scaled text, italic edge labels and a separate bordered status card. The revision keeps the measured radial layout while using theme surfaces, one accent, fixed typography, and an integrated status/footer.

Scope boundary: existing API, entity grouping and navigation are retained. No database or cross-layer contracts change. Existing unrelated App.tsx and fileWatcher changes belong to another task.

Spec review: existing frontend component guidelines already cover theme variables, Tailwind styling and named components; no new shared convention is needed for this visual refinement.

## Validation
- TypeScript parser: EntityGraphView.tsx parsed without syntax diagnostics.
- git diff --check: passed for the changed component.
- No whole-project build or typecheck run, per project instructions.
- Runtime screenshot verification was not performed; final in-app appearance remains to be visually checked.
