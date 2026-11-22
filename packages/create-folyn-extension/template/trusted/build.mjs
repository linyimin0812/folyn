import esbuild from 'esbuild';
import { hostModules } from 'folyn-extension-sdk/build';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

// Trusted tier: the extension renders inline in the host React tree, so it
// MUST share the host's single React instance. Bundling React would create a
// second copy and break hooks ("Invalid hook call"). hostModules() maps
// react, react/jsx-runtime, react-dom and react-i18next to the host's
// instances; pass `{ lucideIcons: [...] }` if you use lucide-react.

await mkdir(path.join(root, 'dist'), { recursive: true });

await esbuild.build({
  entryPoints: [path.join(root, 'src/index.ts')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  outfile: path.join(root, 'dist/index.js'),
  target: 'es2022',
  jsx: 'automatic',
  alias: hostModules(),
  minify: true,
  logLevel: 'warning',
});

// Self-contained installable manifest. The root manifest's `main: "dist/index.js"`
// is rewritten to `"index.js"` inside dist/ so the dist/ folder is directly
// installable (pick it in Settings → Extensions → Install from folder…).
const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
if (typeof manifest.main === 'string') {
  manifest.main = manifest.main.replace(/^dist\//, '');
}
await writeFile(
  path.join(root, 'dist/manifest.json'),
  JSON.stringify(manifest, null, 2) + '\n',
);

console.log('built dist/ — install the dist/ folder in Folyn → Settings → Extensions → Install from folder…');
