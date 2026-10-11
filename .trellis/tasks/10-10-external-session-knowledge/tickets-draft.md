# Proposed vertical slices

Draft for review; these are not yet published agent-ready tickets. All slices implement a complete user-visible path and include focused behavior tests. The first release requires all seven slices.

## 1. Codex browsing and verbatim message capture

Blocked by: none.

Deliver the Sessions entry, source discovery, a Codex conversation reader, message selection and Markdown capture to a chosen current-vault directory. Preserve provenance, obtainable tool evidence and attachments, with missing-material status and a source locator. Verify the installed reading mechanism, archives and event deduplication. Captured evidence remains readable after the source is deleted. Include safe filename handling and write-failure behavior. This establishes the shared capture contract through working behavior, rather than a separate infrastructure-only ticket.

## 2. Claude Code browsing and verbatim message capture

Blocked by: 1.

Add Claude Code to the same list, filters, reader and save flow. Verify the official history API's completeness and runtime requirements before choosing the reading mechanism. Use actual cwd metadata, correlate tool records and retain available attachments. Errors in this source do not remove other sources from the list.

## 3. pi browsing, branches and verbatim message capture

Blocked by: 1.

Add pi sessions to the same flow without opening them through a mutating migration path. Show the current branch, offer branch switching, and save explicitly selected evidence from that branch. Verify parent relationships, compaction/context edits and tool results against fixtures. Other branches are not silently included.

## 4. Text-range and whole-branch capture across all sources

Blocked by: 2, 3.

Users can select arbitrary text in a message or select the entire displayed branch for all three sources, then save an excerpt with precise source references. Preview explicitly included tool evidence. Refresh or branch switching does not retarget an existing selection; changed source content requires reselection.

## 5. AI-organized notes with review and confirmed save

Blocked by: 4.

Use an existing configured model to organize precisely the capture into an editable Markdown draft. Confirming saves the note and its original evidence bundle to the chosen current-vault directory. Insufficient context, unsupported selected image input, oversized input, generation failure and cancellation produce explicit states. Prove with a model stub that unselected content and prior history are absent.

## 6. Source navigation and independent evidence reading

Blocked by: 4.

From a saved excerpt or note, navigate to its source records and branch in Folyn. If the live source is missing or changed, open the saved evidence with capture time and completeness information. Available attachments remain readable through vault-relative links after restart and after moving the vault. Message capture in earlier slices already stores the evidence; this slice provides the full navigation experience.

## 7. First-release acceptance across three sources

Blocked by: 5, 6.

Verify the complete release flows across Codex, Claude Code and pi: discovery, project/source filtering, entry/open/manual refresh, both selection modes, current-branch whole selection, both capture modes, review, save and provenance retrieval. Add only missing behavior regressions, including unfinished source writes, inaccessible roots, unsupported format, missing attachments, save failures and vault switching. Use targeted checks; no whole-project builds.

## Review points

- Are these slices an appropriate size, especially the first end-to-end capture?
- Do the blocking edges reflect genuine prerequisites?
- Should any slices be split or combined?
- Proposed primary test seam: external-session/capture service with source fixtures, test vault and model stub, plus focused UI interaction coverage.
- Proposed publication destination: this Trellis task's local issues directory, matching existing task conventions; requires confirmation because no Matt tracker configuration was found.
