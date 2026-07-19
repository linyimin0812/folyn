// String Unescaper — sandbox-tier tool window. No permissions, no RPC.
// Self-contained: unescape JS/JSON-style string literals + render a markdown
// subset. No external deps (CSP forbids remote; the lazy path is a small
// subset, not vendoring marked.js).

const inputEl = document.getElementById('input');
const rawEl = document.getElementById('raw');
const previewEl = document.getElementById('preview');

/** Strip one pair of surrounding "..." or '...' quotes from the ORIGINAL input
 *  (before unescape). Only literal quotes count — `\"` becomes `"` after
 *  unescape and is preserved, since the original didn't have literal quotes. */
function stripQuotes(s) {
  if (s.length < 2) return s;
  const first = s[0];
  const last = s[s.length - 1];
  if ((first === '"' || first === "'") && first === last) return s.slice(1, -1);
  return s;
}

// ponytail: walks the string char-by-char rather than a regex with N capture
// groups — easier to get right across \uXXXX / \xXX / unknown escapes, and
// fast enough for clipboard-sized strings.
function unescape(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== '\\') { out += c; continue; }
    const next = s[i + 1];
    if (next === undefined) { out += '\\'; break; }
    switch (next) {
      case 'b': out += '\b'; i++; break;
      case 'f': out += '\f'; i++; break;
      case 'n': out += '\n'; i++; break;
      case 'r': out += '\r'; i++; break;
      case 't': out += '\t'; i++; break;
      case 'v': out += '\v'; i++; break;
      case '0': out += '\0'; i++; break;
      case '"': out += '"'; i++; break;
      case "'": out += "'"; i++; break;
      case '\\': out += '\\'; i++; break;
      case '/': out += '/'; i++; break;
      case 'u': {
        const hex = s.slice(i + 2, i + 6);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) { out += String.fromCharCode(parseInt(hex, 16)); i += 5; }
        else { out += next; i++; }
        break;
      }
      case 'x': {
        const hex = s.slice(i + 2, i + 4);
        if (/^[0-9a-fA-F]{2}$/.test(hex)) { out += String.fromCharCode(parseInt(hex, 16)); i += 3; }
        else { out += next; i++; }
        break;
      }
      default: out += next; i++;
    }
  }
  return out;
}

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ponytail: minimal markdown subset — headings, paragraphs, ul/ol, blockquote,
// fenced code blocks, inline bold/italic/code/link. No GFM tables/footnotes/
// raw HTML. Upgrade path: co-locate marked.js in this folder and call it
// (script-src quill-plugin: allows sibling files).
function renderInline(s) {
  let out = s;
  // Inline code first — content inside is not further transformed.
  out = out.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
  // Links: only http(s)/mailto to avoid javascript: URLs.
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g, (_, t, u) => `<a href="${u}" target="_blank" rel="noopener">${t}</a>`);
  // Bold then italic (so ** is consumed before *).
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  out = out.replace(/_([^_]+)_/g, '<em>$1</em>');
  return out;
}

function renderMarkdown(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let i = 0;
  let para = [];

  const flushPara = () => {
    if (para.length) {
      blocks.push(`<p>${renderInline(para.join('<br/>'))}</p>`);
      para = [];
    }
  };

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block.
    if (/^```/.test(line)) {
      flushPara();
      const lang = line.slice(3).trim();
      let j = i + 1;
      const code = [];
      while (j < lines.length && !/^```/.test(lines[j])) { code.push(lines[j]); j++; }
      blocks.push(`<pre><code${lang ? ` class="language-${escapeHtml(lang)}"` : ''}>${escapeHtml(code.join('\n'))}</code></pre>`);
      i = j + 1;
      continue;
    }

    // Blank line → paragraph break.
    if (line.trim() === '') { flushPara(); i++; continue; }

    // Heading.
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      flushPara();
      const level = h[1].length;
      blocks.push(`<h${level}>${renderInline(escapeHtml(h[2]))}</h${level}>`);
      i++;
      continue;
    }

    // Blockquote.
    if (/^>\s?/.test(line)) {
      flushPara();
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i++; }
      blocks.push(`<blockquote>${renderInline(escapeHtml(buf.join(' ')))}</blockquote>`);
      continue;
    }

    // Unordered list.
    if (/^\s*[-*]\s+/.test(line)) {
      flushPara();
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { items.push(renderInline(escapeHtml(lines[i].replace(/^\s*[-*]\s+/, '')))); i++; }
      blocks.push(`<ul>${items.map((it) => `<li>${it}</li>`).join('')}</ul>`);
      continue;
    }

    // Ordered list.
    if (/^\s*\d+\.\s+/.test(line)) {
      flushPara();
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { items.push(renderInline(escapeHtml(lines[i].replace(/^\s*\d+\.\s+/, '')))); i++; }
      blocks.push(`<ol>${items.map((it) => `<li>${it}</li>`).join('')}</ol>`);
      continue;
    }

    // Default: paragraph line. Escape HTML inline so `<br/>` joins work.
    para.push(escapeHtml(line));
    i++;
  }
  flushPara();
  return blocks.join('\n');
}

function update() {
  const raw = unescape(stripQuotes(inputEl.value));
  rawEl.textContent = raw || '(empty)';
  if (!raw.trim()) {
    previewEl.innerHTML = '<p style="color:var(--t3)">(empty)</p>';
    return;
  }
  previewEl.innerHTML = renderMarkdown(raw) || '<p style="color:var(--t3)">(no markdown)</p>';
}

inputEl.addEventListener('input', update);

// ponytail: Tauri WebviewWindow menu accelerators can intercept Cmd/Ctrl+A
// before it reaches the iframe's textarea. Handle it ourselves so select-all
// always works inside the input pane.
inputEl.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && (e.key === 'a' || e.key === 'A')) {
    e.preventDefault();
    inputEl.select();
  }
});

update();

// ponytail: self-check — assert the core unescape path on load so a future
// refactor that breaks it surfaces immediately in the dev console.
(function demo() {
  const cases = [
    ['\\n', '\n'],
    ['\\t\\n', '\t\n'],
    ['\\u4e2d\\u6587', '中文'],
    ['\\"hi\\"', '"hi"'],
    ['\\\\path\\\\to', '\\path\\to'],
    ['"quoted"', 'quoted'],
    ["'single'", 'single'],
    ['\\x41', 'A'],
    ['\\unknown', 'unknown'],
  ];
  for (const [inp, expected] of cases) {
    const got = unescape(stripQuotes(inp));
    if (got !== expected) {
      console.error('[string-unescaper] self-check failed:', { inp, expected, got });
    }
  }
})();
