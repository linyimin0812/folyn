// Plugin Export Demo — trusted-tier plugin (in-process).
//
// Exercises the contribution points added in
// `08-06-refactor-plugin-sdk-npm`:
//   - `contributes.exporters[]`        → `PluginModule.exporters` map
//   - `contributes.fileTemplates[]`    → declarative (no module map)
//   - `contributes.keybindings[]`      → binds a key to a command id
//   - `contributes.containers[]`       → `PluginModule.containers` map
//   - `contributes.exportEnhancers[]`  → `PluginModule.exportEnhancers` map
//
// Self-contained ESM: no bare runtime imports. The trusted loader wraps this
// in a blob URL and `import()`-s it into the host realm. The `quote` container
// uses `window.React` + `createElement` (no JSX) per the trusted-plugin
// rendering contract (see docs/plugin-development.md "Trusted tier bundling").

/**
 * Best-effort React loader. The host exposes `window.React` for trusted
 * plugins that render inline (see trusted-plugin-rendering.md spec). A
 * production plugin should bundle React so this is not needed.
 */
function _loadReact() {
  if (typeof window !== 'undefined' && window.React) {
    return window.React;
  }
  throw new Error(
    '[plugin-export-demo] window.React not available — host must expose it',
  );
}

/**
 * `:::quote` container renderer. A blockquote with a citation. During export,
 * the `enhanceQuote` enhancer appends a self-contained `<cite>` and wraps the
 * body in an inline-styled box, demonstrating the exportEnhancers hook without
 * needing a real canvas.
 */
function QuoteContainer(props) {
  const R = _loadReact();
  var h = R.createElement;
  var text = '';
  if (typeof props.children === 'string') {
    text = props.children;
  } else if (props.children != null) {
    text = String(props.children);
  }
  return h(
    'div',
    {
      className: 'docmd-quote',
      style: {
        borderLeft: '3px solid var(--acc, #3a6ef0)',
        padding: '8px 16px',
        margin: '12px 0',
        background: 'var(--surf2, #eef0f8)',
        borderRadius: '0 6px 6px 0',
        fontStyle: 'italic',
        color: 'var(--t2, #4a5580)',
      },
    },
    text,
  );
}

/**
 * Export enhancer for `:::quote`. Runs host-realm on the rendered
 * HTMLElement after the in-DOM render has settled. Appends a `<cite>` and
 * wraps the body content in an inline-styled box so the exported HTML is
 * self-contained (no dependency on app CSS variables resolving).
 *
 * @type {import('@quill/plugin-host').ExportEnhancerHandler}
 */
async function enhanceQuote(body, _ctx) {
  // Wrap existing content in a self-contained inline-styled box.
  var inner = body.innerHTML;
  body.innerHTML = '';
  var box = document.createElement('div');
  box.style.cssText =
    'border:1px solid #dde2f0;border-radius:6px;padding:12px 16px;margin:12px 0;background:#f8f9fd;';
  box.innerHTML = inner;
  var cite = document.createElement('div');
  cite.style.cssText =
    'font-size:11px;color:#8892b0;margin-top:8px;font-style:normal;text-align:right;';
  cite.textContent = '— exported via plugin-export-demo';
  box.appendChild(cite);
  body.appendChild(box);
}

/**
 * Exporter: prepend a header (file name + export timestamp) to the active
 * doc's content and return it as a string. The host wraps it in a Blob and
 * runs the save dialog (see `exporterAdapter.ts`).
 *
 * @type {import('@quill/plugin-host').ExporterHandler}
 */
async function exportTxtWithHeader(content, ctx) {
  const stamp = new Date().toISOString();
  return `# Exported from ${ctx.filePath || 'untitled'}\n# ${stamp}\n\n${content}`;
}

/** Command handler bound by `contributes.commands[].run`. */
function pingCommand() {
  console.info('[plugin-export-demo] ping fired (Cmd+Alt+Shift+T)');
}

export const containers = { quote: QuoteContainer };
export const exporters = { 'txt-with-header': exportTxtWithHeader };
export const exportEnhancers = { 'enhance-quote': enhanceQuote };
export const commands = { ping: pingCommand };

export function activate() {
  console.info('[plugin-export-demo] activated');
}

export function deactivate() {
  console.info('[plugin-export-demo] deactivated');
}
