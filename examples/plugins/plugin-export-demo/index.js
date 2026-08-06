// Plugin Export Demo — trusted-tier plugin (in-process).
//
// Exercises all 3 new contribution points added in
// `08-06-refactor-plugin-sdk-npm`:
//   - `contributes.exporters[]`     → `PluginModule.exporters` map
//   - `contributes.fileTemplates[]` → declarative (no module map)
//   - `contributes.keybindings[]`   → binds a key to a command id
//
// Self-contained ESM: no bare runtime imports. The trusted loader wraps this
// in a blob URL and `import()`-s it into the host realm. No JSX / no React
// here because this plugin contributes no inline React components — exporters
// are plain async functions. (For a plugin that renders React inline, see
// `ai-chat-demo/index.js` for the `window.React` + `createElement` pattern.)

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

export const exporters = { 'txt-with-header': exportTxtWithHeader };
export const commands = { ping: pingCommand };

export function activate() {
  console.info('[plugin-export-demo] activated');
}

export function deactivate() {
  console.info('[plugin-export-demo] deactivated');
}
