# Activity report: rendered preview instead of raw markdown, closable

## Requirements
1. The 日/周/月 report panel in ActivityPage currently shows `{report.markdown}` inside a `<pre>` — replace with rendered markdown (reuse `renderMarkdownToReact` from `@/services/markdown/renderMarkdown`, the same pipeline chat uses; remark-gfm for tables).
2. Add a close button to the report panel header that hides the preview (setReport(null)); file stays on disk.
3. No new dependencies, no new files — a small memoized component inside ActivityPage.tsx.

## Files
- apps/desktop/src/components/activity/ActivityPage.tsx
