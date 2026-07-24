// Extract the contents of the last ```json fenced code block in a markdown
// text. Returns null when no such fence exists. The contents are returned
// verbatim (whitespace preserved, including a trailing newline if the AI
// put one before the closing fence) — JSON.parse tolerates surrounding
// whitespace, and `tryImport` reuses the same parser.
//
// ponytail: strict ```json tag — the system prompt instructs the AI to
// wrap its final draft in a ```json fence, so we don't match bare ```
// fences. If the AI drops the tag, the import button won't appear and the
// user can correct in the next turn. Widen to bare ``` only if real usage
// shows the AI frequently drops the tag.
const JSON_FENCE_RE = /```json[^\n]*\n([\s\S]*?)```/g;

export function extractLastJsonFence(markdown: string): string | null {
  if (!markdown) return null;
  const matches = [...markdown.matchAll(JSON_FENCE_RE)];
  if (matches.length === 0) return null;
  return matches[matches.length - 1][1] ?? null;
}
