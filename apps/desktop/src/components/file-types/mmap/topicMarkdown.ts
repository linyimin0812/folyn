// ponytail: hand-rolled regex over a real markdown lib — mind-elixir's README
// shows this exact pattern for its `markdown:` callback; topic text is
// single-line, so a remark→rehype pipeline is unjustified. If multi-line
// topics or nested syntax ever land here, swap this for remark-stringify.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function topicMarkdown(text: string): string {
  const escaped = escapeHtml(text);
  return escaped
    .replace(
      /!\[([^\]]*)\]\(([^)]+)\)/g,
      '<img src="$2" alt="$1" style="max-width:200px;max-height:120px;vertical-align:middle">',
    )
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}
