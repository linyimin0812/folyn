# External Session Knowledge Capture — Draft

## Problem Statement

Useful technical knowledge is scattered across local Codex, Claude Code and pi conversations. Users need to find relevant discussions and deliberately preserve selected material in their Folyn vault without copying entire unrelated histories or losing the supporting evidence.

## Solution

Add an independent Sessions entry. Users browse local persisted conversations, filter by source and project, select messages or text, and either save a verbatim excerpt or generate an editable knowledge note. Both produce Markdown in the current vault and retain source evidence and obtainable attachments. Missing material remains explicit.

## User Stories

1. As a Folyn user, I want a dedicated Sessions entry so that conversations have a consistent browsing location.
2. As a Folyn user, I want Codex, Claude Code and pi supported in the first release so that all three sources contribute knowledge.
3. As a Folyn user, I want conversations across local projects listed so that I can reuse knowledge across projects.
4. As a Folyn user, I want source and project filters so that I can narrow the list.
5. As a Folyn user, I want fresh data on entering the list or opening a conversation so that ongoing work can be reviewed.
6. As a Folyn user, I want manual refresh so that I can request the latest state.
7. As a Folyn user, I want readable messages, code, tool results and attachments so that I can evaluate their value.
8. As a Folyn user, I want to select one or multiple messages so that I can preserve a discussion.
9. As a Folyn user, I want to select text within a message so that unrelated paragraphs stay excluded.
10. As a Folyn user, I want whole-conversation selection to mean the current branch so that contradictory alternatives stay separate.
11. As a Folyn user, I want to switch branches and select their content separately so that earlier attempts remain accessible.
12. As a Folyn user, I want verbatim capture so that original wording is preserved.
13. As a Folyn user, I want AI to organize selected content into a standalone note so that knowledge is easier to reuse.
14. As a Folyn user, I want to edit and confirm the generated note so that I control what enters my vault.
15. As a Folyn user, I want AI to receive only selected material so that selection defines the processing boundary.
16. As a Folyn user, I want insufficient context reported so that I can select additional evidence.
17. As a Folyn user, I want Markdown saved to a chosen directory in the current vault so that my existing organization still applies.
18. As a Folyn user, I want source tool, title, project and timestamps retained so that provenance stays visible.
19. As a Folyn user, I want to return to the source location in Folyn so that I can inspect surrounding discussion.
20. As a Folyn user, I want an independent copy of selected evidence so that deletion of the source does not erase my basis.
21. As a Folyn user, I want obtainable attachments copied so that saved knowledge remains readable later.
22. As a Folyn user, I want missing or truncated material identified before saving and in the saved record so that incomplete evidence is apparent.
23. As a Folyn user, I want readable material saved despite missing attachments so that useful knowledge is not discarded.

## Implementation Decisions

- A read-only external-session service owns discovery, source parsing, branch projection and stable source references. Three source adapters share one application contract; existing CLI execution adapters remain responsible for running tools.
- Discovery covers readable local persisted records, including supported archived records. Remote-only, deleted and non-persisted conversations cannot be recovered. Default locations and explicit source storage roots must be respected; missing roots are empty sources, while permission or format errors are reported per source.
- Verify installed versions and official history-reading APIs before choosing each adapter mechanism. Do not make an SDK and raw parser into competing fallback paths. Select one mechanism per supported source after verification and document its supported format. Reads must never resume, migrate or mutate source sessions.
- Summary identity includes source and native session ID. Project identity uses recorded working directory rather than decoding directory names. Missing metadata remains unknown. Duplicate physical records need deterministic handling without conflating different source tools.
- Detail reading retains original record references separately from display messages. Source adapters handle duplicated events, tool-call/result relationships and branching. Whole-conversation selection uses the displayed branch, not every physical record in a session file.
- Entering the list refreshes discovery; opening a conversation reads its current detail. Manual refresh is explicit. No background watcher is required. A trailing unfinished record must not invalidate preceding complete records.
- Selection produces an immutable capture containing selected text ranges or message blocks, explicitly included tool records, provenance, assets and completeness status. Any automatically associated tool evidence is visible in the selection preview. Refresh and branch changes must not silently retarget a selection; require reselection if its source changed.
- Verbatim rendering, AI input and evidence saving use the same capture. Selecting text does not authorize including the rest of its message. Referenced unknown records are retained as evidence where selected, with an honest unsupported display state.
- AI uses the existing tool-free model call with isolated history. Selected attachments are supplied only when the configured model supports them; otherwise request text-only processing explicitly or another model. Do not silently omit selected material, add surrounding history, or truncate oversized input.
- Notes are editable drafts until confirmed. Cancellation, generation errors and vault switching must not write a note to an unintended vault. Bind a save operation to the vault the user confirms, not whichever vault is active when asynchronous work finishes.
- Markdown contains readable provenance and links to a companion evidence bundle. The bundle stores selected original records, selection coordinates, branch identity, capture time, record digests, completeness information and obtainable asset bytes. Use relative vault links so moving the vault does not break saved evidence.
- Source navigation identifies the original session, branch and selected records. If the source vanished or changed, retain access to the capture rather than claiming the live record still matches.
- Copy assets through binary-preserving provider operations. Missing, encrypted, remote-only or truncated evidence is recorded with known reasons. Never label such a capture complete or reconstruct missing source data with AI.
- Publish Markdown only after its available evidence and assets have been saved. File-write failures differ from missing source assets: report the failure and do not present a successful capture with broken companion links. Avoid overwriting an existing note silently.
- Reuse existing panel registration, Markdown message rendering, directory selection, vault operations and model configuration where their contracts fit. No project-wide refactor or new database is required by this feature.

## Testing Decisions

- Proposed primary seam: public external-session/capture service behavior with temporary source roots, a test vault provider and a model stub. Assert what users can discover, select, save and later retrieve; do not assert private parser helpers or implementation structure.
- Use small synthetic source fixtures for each supported format. Cover cross-project discovery, duplicated events, branch projection, tool relationships, images, unknown records, incomplete trailing records and missing sources. Never use personal transcripts as committed fixtures.
- Prove saved evidence survives deletion of its source and that binary assets remain byte-identical. Cover missing assets, failed writes, filename conflicts, source changes and asynchronous vault switching.
- Inspect model-stub input to prove unselected content and prior request history are absent. Cover failure, cancellation, oversized selections and insufficient-context feedback without real paid calls.
- Use focused component interaction tests for source/project filters, selection ranges, branch switching, draft confirmation and save destination. Existing message-selection, vault-manager and model-bridge tests provide prior art.
- Run targeted checks only; do not run whole-project compiles or builds under the project instructions.
- These test seams are proposed for user review before publishing the implementation specification.

## Out of Scope

Automatic knowledge collection, background monitoring and notifications, sending commands or resuming source sessions, cross-device synchronization, remote-only conversation retrieval, automatic merging into existing notes, reconstruction of deleted evidence, source-history migrations and compatibility layers.

## Further Notes

Product requirements and research live with the Trellis planning task. This is a draft implementation specification, not a promise that every installed upstream version has already been verified. First implementation must verify the chosen reading mechanisms before committing to their contracts. Tracker configuration was not found; use this existing Trellis task for review artifacts until publication destination is confirmed.
