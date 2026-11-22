import esbuild from 'esbuild';
import { hostModules } from 'folyn-extension-sdk/build';
import { build as viteBuild } from 'vite';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

/**
 * Two bundles:
 * 1. HOST bundle (`dist/index.js`) — the trusted ExtensionModule (registers the
 *    `dbml` FileTypeProvider with DbmlFrame + the editor status button).
 *    Loaded from a blob URL, so React resolves to the host's instance
 *    (hostModules). The status button is styled with the host's
 *    Tailwind classes; the host's tailwind.config.js scans every extension's
 *    `src`.
 * 2. IFRAME bundle (`dist/dbml-preview.html` + assets, via vite) — @dbml/core
 *    + @antv/x6 render at the extension origin.
 */

await mkdir(path.join(root, 'dist'), { recursive: true });

// Copy sql.svg as a standalone asset so manifest.icon can point at it —
// the host bundle inlines sql.svg via esbuild's dataurl loader, but the
// settings page reads the manifest icon path separately via read_extension_file.
await copyFile(path.join(root, 'src/icons/sql.svg'), path.join(root, 'dist/sql.svg'));

// 1. Host bundle.
await esbuild.build({
  entryPoints: [path.join(root, 'src/index.tsx')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  outfile: path.join(root, 'dist/index.js'),
  target: 'es2022',
  jsx: 'automatic',
  alias: hostModules(),
  loader: { '.svg': 'dataurl' },
  minify: true,
  logLevel: 'warning',
});
console.log('host bundle → dist/index.js');

// 2. Iframe bundle (vite: @dbml/core + @antv/x6 code-split).
await viteBuild({ configFile: path.join(root, 'vite.config.ts') });
console.log('iframe bundle → dist/dbml-preview.html');

// 3. Installable manifest.
const manifest = JSON.parse(await readFile(path.join(root, 'src/manifest.json'), 'utf8'));
if (typeof manifest.main === 'string') {
  manifest.main = manifest.main.replace(/^dist\//, '');
}
await writeFile(
  path.join(root, 'dist/manifest.json'),
  JSON.stringify(manifest, null, 2) + '\n',
);

console.log('built dist/ — install the dist/ folder in Folyn → Extensions → Install from folder…');
