// Markdown Table Generator — sandbox-tier tool window.
//
// Demonstrates the fetch-RPC bridge: plugin JS calls
// `fetch('quill-plugin://localhost/<plugin-id>/rpc', { method: 'POST', body:
// JSON.stringify({ method: 'vault:insert-content', params: { content } }) })`
// and the host validates against the manifest's `permissions.vault.insertContent`
// (declared true in manifest.json) before writing into the active doc.

const PLUGIN_ID = 'markdown-table';
const inputEl = document.getElementById('input');
const previewEl = document.getElementById('preview');
const delimEl = document.getElementById('delim');
const insertBtn = document.getElementById('insert');
const statusEl = document.getElementById('status');

/** Parse the delimiter <option> value (`"\t"` literal → tab char). */
function getDelimiter() {
  const v = delimEl.value;
  if (v === '\\t') return '\t';
  return v;
}

/** Parse CSV-ish text into rows of cells. Splits each line on the delimiter. */
function parseTable(text, delim) {
  const rows = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (rows.length === 0) return [];
  return rows.map((r) => r.split(delim).map((c) => c.trim()));
}

/** Render rows as a markdown table string. First row = header. */
function toMarkdownTable(rows) {
  if (rows.length === 0) return '';
  const header = rows[0];
  const sep = header.map(() => '---');
  const lines = [
    `| ${header.join(' | ')} |`,
    `| ${sep.join(' | ')} |`,
    ...rows.slice(1).map((r) => `| ${r.join(' | ')} |`),
  ];
  return lines.join('\n');
}

/** Recompute the preview + enable/disable the Insert button. */
function update() {
  const delim = getDelimiter();
  const rows = parseTable(inputEl.value, delim);
  const table = toMarkdownTable(rows);
  previewEl.textContent = table || '(preview)';
  insertBtn.disabled = rows.length === 0;
}

inputEl.addEventListener('input', update);
delimEl.addEventListener('change', update);

insertBtn.addEventListener('click', async () => {
  const delim = getDelimiter();
  const table = toMarkdownTable(parseTable(inputEl.value, delim));
  if (!table) return;
  insertBtn.disabled = true;
  statusEl.textContent = '';
  statusEl.className = '';
  try {
    const res = await fetch(`quill-plugin://localhost/${PLUGIN_ID}/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: 'vault:insert-content',
        params: { content: '\n' + table + '\n' },
      }),
    });
    const json = await res.json();
    if (!res.ok || json.error) {
      throw new Error(json.error || `HTTP ${res.status}`);
    }
    statusEl.textContent = 'Inserted ✓';
    statusEl.className = 'ok';
  } catch (err) {
    statusEl.textContent = `Failed: ${err instanceof Error ? err.message : String(err)}`;
    statusEl.className = 'error';
  } finally {
    insertBtn.disabled = false;
  }
});

update();
