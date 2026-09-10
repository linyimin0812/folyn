import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileViewerRenderers } from '@file-viewer/vite-plugin';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const extRoot = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.join(extRoot, 'src');
const outDir = path.join(extRoot, 'dist');

/**
 * Builds the extension's IFRAME bundle (`dist/preview.html` + assets). The
 * @file-viewer renderers run there with full Worker / WASM / code-splitting
 * support (real `folyn-plugin://` origin). Vite emits relative asset URLs
 * (`base: './'`) so they resolve against the plugin origin.
 *
 * Vite's root is `src/` so the HTML entry (src/preview.html) lands at
 * `dist/preview.html` rather than `dist/src/preview.html`. `outDir` is
 * outside the root, hence `emptyOutDir: false` — which also keeps the esbuild
 * host bundle (`dist/index.js`) that build.mjs writes first.
 *
 * `fileViewerRenderers({ copyAssets: true })` copies each renderer's static
 * assets (dwg worker + libredwg WASM, pdf.worker + cmaps, drawio viewer,
 * sql-wasm, …) into `dist/` at the paths the renderers resolve by default
 * (relative to the document base) — without it, worker/WASM renderers fail
 * with "worker asset cannot be resolved".
 */
export default defineConfig({
  root: srcRoot,
  base: './',
  plugins: [
    react(),
    fileViewerRenderers({
      preset: 'office',
      renderers: ['archive', 'email', 'eda', 'geo', 'model', 'drawing', 'mindmap', 'ebook', 'image', 'data', 'cad', 'media'],
      copyAssets: true,
      inject: false,
      // The plugin's renderer-oriented manualChunks create cross-chunk cycles
      // in this standalone build (TDZ: "Cannot access 'X' before
      // initialization"). Let Rollup chunk itself — the preset's dynamic
      // imports still split the renderers.
      chunkStrategy: 'none',
    }),
  ],
  build: {
    outDir,
    emptyOutDir: false,
    target: 'es2022',
    rollupOptions: {
      input: path.join(srcRoot, 'preview.html'),
    },
    chunkSizeWarningLimit: 4000,
  },
  resolve: {
    alias: {
      // epubjs imports `jszip/dist/jszip` (legacy bundle path removed in jszip
      // 3.x); alias to the package entry so vite resolves it. Same as the app.
      'jszip/dist/jszip': 'jszip',
    },
  },
});
