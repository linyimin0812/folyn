import esbuild from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

// ponytail: Phase 3 — host bundle only (rich-text renders inline in the host
// React tree via NodeView; no separate origin like dbml's iframe). React +
// react-i18next are aliased to shims reading window.React / window.reactI18next
// (one instance shared with the host — the established pattern for trusted-
// tier blob extensions). Tailwind/PostCSS are NOT built here: the host's
// tailwind.config.js content array includes `extensions/rich-text/src/**`
// so the host's single CSS bundle covers the editor's classes. KaTeX CSS
// is imported in the host's main.tsx. esbuild `.css: 'text'` loader inlines
// the katex CSS string for the standalone HTML exporter (richtextHtml.ts).
const shim = path.join(root, 'src/react-shim.js');
const hostAlias = {
  react: shim,
  'react/jsx-runtime': path.join(root, 'src/react-jsx-runtime-shim.js'),
  'react-i18next': path.join(root, 'src/react-i18next-shim.js'),
  // ponytail: alias react-dom + react-dom/client to host shims too. @tiptap/react
  // transitively imports react-dom (createPortal/flushSync); without these
  // aliases esbuild bundles react-dom into the extension, and that bundled
  // copy's internal imports of react's ReactCurrentBatchConfig hit the
  // react-shim's public-only API → `undefined is not an object` crash.
  'react-dom': path.join(root, 'src/react-dom-shim.js'),
  'react-dom/client': path.join(root, 'src/react-dom-client-shim.js'),
};

await mkdir(path.join(root, 'dist'), { recursive: true });

await esbuild.build({
  entryPoints: [path.join(root, 'src/index.tsx')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  outfile: path.join(root, 'dist/index.js'),
  target: 'es2022',
  jsx: 'automatic',
  alias: hostAlias,
  // ponytail: .css → text string. richtextHtml.ts imports katex.min.css for
  // the standalone HTML export; the text loader returns the raw CSS so the
  // exporter can inline it into the <style> tag of the exported file.
  loader: { '.css': 'text', '.svg': 'dataurl' },
  minify: true,
  logLevel: 'warning',
});
console.log('host bundle → dist/index.js');

const manifest = JSON.parse(await readFile(path.join(root, 'src/manifest.json'), 'utf8'));
if (typeof manifest.main === 'string') {
  manifest.main = manifest.main.replace(/^dist\//, '');
}
await writeFile(
  path.join(root, 'dist/manifest.json'),
  JSON.stringify(manifest, null, 2) + '\n',
);

console.log('built dist/ — install the dist/ folder in Folyn → Plugins → Install from folder…');
