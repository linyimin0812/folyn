# Knowledge workbench interaction improvements

## Goal
Improve the implemented knowledge UI against the existing reading-workbench proposal, preserving all ongoing user/Claude changes and real service wiring.

## Requirements
- Fix the flex height/scroll ownership chain so each workbench page fills its allocated space.
- Make the knowledge landing useful: actual topic overview with navigation and clear empty state, not an empty canvas telling users to click elsewhere.
- Give reading a restrained document hierarchy, bounded line length, topic title and citation count, contextual evidence; keep existing Markdown editor integration.
- Distinguish loading, missing file and loaded topic states; never display old topic content under a new title or stale excerpts after changing citations.
- Polish navigation and primary actions using existing theme tokens; retain compact Folyn shell density without tiny primary reading text.
- Improve question input/result hierarchy and render answers through existing markdown renderer. Preserve actual retrieval, stop and evidence behavior.
- Keep sources/reviews usable at narrow widths; no fabricated data, services or timing.

## Acceptance Criteria
- All four pages have bounded scrolling and no lost bottom actions from missing flex height.
- Topic overview links to actual topics; selecting a topic does not deselect it unexpectedly.
- Topic load/error states and citation excerpt switching are honest.
- Markdown answers are readable; keyboard submission respects IME composition.
- Existing source/review logic and editor navigation remain intact.
- Targeted regressions for loading/race behavior where useful; no whole-project builds/typecheck.

## Scope
This is a UI and state presentation refinement against previously established requirements, not a new backend design or retrieval-quality claim. No new dependencies, no commits of pre-existing changes.

## Context
Read implement.jsonl and the UI notes/prototype linked in info.md. User requested optimization after dissatisfaction with Claude implementation; do not reopen confirmed product decisions.

## Interaction refinement (user follow-up)

User reports interaction remains awkward. This phase fixes verified workflow gaps, not more visual polish:
- Source settings entry opens the actual settings; adding sources is a direct visible action opening the scope picker.
- Goal/scope are drafts until successful save. Cancel discards edits; failure stays in the form with error and never starts a build or pretends success. Config save must expose an honest success result; no goal update that unmounts first-use before disk write.
- Files inherited from a selected directory must not look independently deselectable when clicking cannot exclude them. Make this explicit in the picker.
- Opening a topic/source in the existing editor provides a direct return to the knowledge workspace. Failed opens keep current context and show the failure.
- Preserve per-topic reading position and chosen citation across knowledge page switches and editor round trips. Keep data scoped to the current vault; no new editor or disk schema.
- Keep all established real backend contracts and pre-existing uncommitted changes. Add meaningful regressions for save failure, direct entry, drafts/cancel and read-state restoration. No whole-project build.

### User-selected priority

The user explicitly chose **source intake, knowledge generation and updates** as the painful interaction. Defer editor-return and reading-position work from the broad proposal above. This iteration must complete the intake loop:
1. Direct Add sources with searchable supported files/directories and an honest file-count preview.
2. Draft selection/settings; Save only vs Save and organize are explicit; cancel preserves committed configuration.
3. During processing show real per-item progress and stop-request semantics; after completion show processed/skipped/failed/unprocessed results and usable retry.
4. Link each source to its actual associated topics and review items. Label related results honestly instead of claiming topics changed when the backend does not report that.
5. Explain automatic processing truthfully: existing lifecycle only observes changes while the knowledge panel is mounted.

## Scope picker visual refinement

User explicitly requests a more refined and attractive scope picker. Preserve all selection/draft/save semantics. Style it as a compact, polished file browser with themed search toolbar, directory/file icons, readable hierarchy, deliberate checkbox selection states, quiet metadata and selection summary. Support light/dark and narrow embedded work areas. Reuse existing Lucide/theme tokens; no dependencies, gradients or ornamental graphics. Limit changes to ScopePicker + scoped styles, with no new selection features unless necessary. Verify actual component visually and retain source-flow regression coverage; do not add tests that merely assert styling classes.
