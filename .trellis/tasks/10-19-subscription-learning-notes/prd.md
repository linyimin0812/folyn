# Subscription learning note handoff

Approved product direction: variant A in `/Users/yiminlin/project/folyn-extensions/extensions/subscriptions/docs/learning-workflow-draft.md`. Implementation is delegated from the extension task; no additional product interview is needed.

## Requirements
- Add SDK snapshots `{path,title,text}` and pinned-session `chooseNotes`, `readNote`, `appendNote(path,text,expectedText)`.
- Only select current-vault Markdown files; prefer unsaved native editor text.
- Append only after explicit caller action and exact snapshot comparison. Preserve dirty buffers and insert one undoable CodeMirror transaction.
- Open unopened targets via the native editor service. Reject stale vault sessions, disposal, changed targets, path escape, and unsupported editor modes.
- Reuse current subscriptions grant. No new AI integration or permissions.

## Verification
Focused desktop tests for the capability and editor append seam, SDK typecheck/build, no whole-project compile. No commit or publishing.
