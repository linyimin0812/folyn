import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

/**
 * Builds the extension's IFRAME bundle (`preview.html` + assets) — the
 * @file-viewer renderers run there with full Worker / WASM / code-splitting
 * support (real `folyn-plugin://` origin). Vite emits relative asset URLs
 * (`base: './'`) so they resolve against the plugin origin.
 *
 * The host-realm bundle (`dist/index.js`, the PluginModule) is built
 * separately by `build.mjs` with esbuild.
 */
export default defineConfig({
  root,
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: false, // keep the esbuild-produced index.js
    target: 'es2022',
    rollupOptions: {
      input: path.join(root, 'preview.html'),
    },
  },
});
