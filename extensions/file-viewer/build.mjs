import esbuild from 'esbuild';
import { build as viteBuild } from 'vite';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

/**
 * Two bundles:
 *
 * 1. HOST bundle (`dist/index.js`) — the trusted PluginModule. Loaded from a
 *    blob URL, so it MUST be self-contained: `react` / `react/jsx-runtime`
 *    alias to shims reading the host's `window.React` (one React instance),
 *    Node built-ins pulled by a couple of deps alias to a browser shim. This
 *    bundle is tiny — the renderers are NOT here.
 * 2. IFRAME bundle (`dist/preview.html` + assets, via vite) — the actual
 *    @file-viewer renderers, served from the plugin's `folyn-plugin://` origin
 *    where Workers / WASM / relative asset URLs resolve.
 */
const shim = path.join(root, 'src/shims/node-empty.js');
const hostAlias = {
  react: path.join(root, 'src/react-shim.js'),
  'react/jsx-runtime': path.join(root, 'src/react-jsx-runtime-shim.js'),
  'fs/promises': shim, fs: shim, util: shim, zlib: shim, events: shim,
  stream: shim, path: shim, os: shim, crypto: shim, assert: shim,
  buffer: shim, url: shim, child_process: shim,
};

await mkdir(path.join(root, 'dist'), { recursive: true });

// 1. Host bundle.
await esbuild.build({
  entryPoints: [path.join(root, 'src/index.tsx')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  outfile: path.join(root, 'dist/index.js'),
  target: 'es2022',
  jsx: 'automatic',
  alias: hostAlias,
  minify: true,
  logLevel: 'warning',
});
console.log('host bundle → dist/index.js');

// 2. Iframe bundle (vite: workers + WASM + CSS).
await viteBuild({ configFile: path.join(root, 'vite.config.ts') });
console.log('iframe bundle → dist/preview.html');

// 3. Self-contained installable manifest.
const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
if (typeof manifest.main === 'string') {
  manifest.main = manifest.main.replace(/^dist\//, '');
}
await writeFile(
  path.join(root, 'dist/manifest.json'),
  JSON.stringify(manifest, null, 2) + '\n',
);

console.log('built dist/ — install this folder in Folyn → Plugins → Install from folder…');
