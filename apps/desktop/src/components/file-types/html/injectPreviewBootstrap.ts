/**
 * Sandbox bootstrap injector for HTML Preview.
 *
 * `HtmlPreview` renders arbitrary vault `.html` content inside an iframe with
 * `sandbox="allow-scripts"` only (no `allow-same-origin`) so inline scripts
 * cannot reach `parent.window.__TAURI__` / parent localStorage (privilege
 * escalation). The two legitimate operations that the old `onLoad` handler
 * performed via same-origin parent-DOM access — force light canvas + intercept
 * anchor clicks for in-document navigation — operate on the iframe's OWN
 * document, so they can be inlined into the srcDoc itself. The iframe's inline
 * script touching its own document is same-origin-to-itself and safe.
 *
 * Parsing uses `DOMParser.parseFromString(rawHtml, 'text/html')` — parsing
 * never executes scripts, so this injection is safe to run on untrusted HTML.
 */

const BOOTSTRAP_STYLE = 'html,body{color-scheme:light !important;background:#fff !important}';

const BOOTSTRAP_SCRIPT = `(function(){
  document.addEventListener('click', function(ev){
    var a = ev.target && ev.target.closest && ev.target.closest('a');
    if(!a) return;
    var href = a.getAttribute('href');
    if(!href) return;
    ev.preventDefault();
    if(href.charAt(0) === '#'){
      var id = href.slice(1);
      var target = document.querySelector(href) || document.querySelector('[name="'+id+'"]');
      if(target && target.scrollIntoView) target.scrollIntoView({behavior:'smooth'});
    }
    // ponytail: non-# href stays a dead link, matching the pre-fix onLoad behavior.
  });
  // ponytail: this iframe is sandbox="allow-scripts" (no allow-same-origin),
  // so it is a separate document whose dragover/drop do NOT bubble to the
  // parent window — WKWebView's default drop navigates the iframe to the
  // file (raw file content replaces the preview). preventDefault and forward
  // the WebKit \`.path\` to the parent via postMessage (cross-origin-safe);
  // the parent's message listener routes through the same openFile path.
  function isFile(e){ return e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.indexOf('Files') !== -1; }
  document.addEventListener('dragover', function(e){
    if(!isFile(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    window.parent.postMessage({ type: 'folyn:file-drag-active' }, '*');
  });
  document.addEventListener('drop', function(e){
    if(!isFile(e)) return;
    e.preventDefault();
    // Forward File objects (not .path): this iframe is sandbox="allow-scripts"
    // only (no allow-same-origin) → cross-origin → WKWebView hides the private
    // File.path, so reading files[i].path here is always undefined and drops
    // were silently lost. File objects survive postMessage structured clone;
    // the parent's openDroppedFiles handles path/staging per-platform.
    var files = e.dataTransfer.files;
    var arr = [];
    if(files) for(var i=0;i<files.length;i++) arr.push(files[i]);
    if(arr.length > 0) window.parent.postMessage({ type: 'folyn:open-dropped-files', files: arr }, '*');
  });
})();`;

/**
 * Inject the bootstrap `<style>` (light canvas) + `<script>` (anchor nav) into
 * a raw HTML string, returning a srcDoc-safe document string. Fragment HTML
 * (no head/body) is normalized into a full document by DOMParser; `doc.head`
 * and `doc.body` are guaranteed to exist under `text/html` parsing.
 */
export function injectPreviewBootstrap(rawHtml: string): string {
  if (!rawHtml || !rawHtml.trim()) {
    // ponytail: empty input still needs a valid (sandboxed) document so the
    // iframe renders a white canvas instead of inheriting parent dark theme.
    return `<!DOCTYPE html><html><head><style data-folyn-preview="light">${BOOTSTRAP_STYLE}</style></head><body><script data-folyn-preview="anchors">${BOOTSTRAP_SCRIPT}</script></body></html>`;
  }

  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(rawHtml, 'text/html');
  } catch {
    // ponytail: DOMParser doesn't throw in practice; guard for non-browser envs.
    return rawHtml;
  }

  // Light-theme style — injected once. If the document already contains an
  // identical rule we still inject; CSS de-dupes, and the !important ensures
  // the white canvas wins over any inherited dark color-scheme.
  const style = doc.createElement('style');
  style.setAttribute('data-folyn-preview', 'light');
  style.textContent = BOOTSTRAP_STYLE;
  doc.head.appendChild(style);

  const script = doc.createElement('script');
  script.setAttribute('data-folyn-preview', 'anchors');
  script.textContent = BOOTSTRAP_SCRIPT;
  doc.body.appendChild(script);

  const doctype = doc.doctype ? `<!DOCTYPE ${doc.doctype.name}>` : '<!DOCTYPE html>';
  return `${doctype}${doc.documentElement.outerHTML}`;
}
