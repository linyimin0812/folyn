import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileViewerRenderers } from '@file-viewer/vite-plugin';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

/**
 * Builds the extension's IFRAME bundle (`preview.html` + assets). The
 * @file-viewer renderers run there with full Worker / WASM / code-splitting
 * support (real `folyn-plugin://` origin). Vite emits relative asset URLs
 * (`base: './'`) so they resolve against the plugin origin.
 *
 * `fileViewerRenderers({ copyAssets: true })` copies each renderer's static
 * assets (dwg worker, pdf.worker, cmaps, WASM, drawio viewer assets, …) into
 * `dist/` at the paths the renderers resolve by default (relative to the
 * document base) — without it, worker/WASM-based renderers (cad/pdf/…) fail
 * with "worker asset cannot be resolved".
 */
export default defineConfig({
  root,
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
      // initialization" in file-viewer-word-*.js). Let Rollup chunk itself —
      // dynamic imports in the preset still split the renderers.
      chunkStrategy: 'none',
    }),
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: false, // keep the esbuild-produced index.js
    target: 'es2022',
    rollupOptions: {
      input: path.join(root, 'preview.html'),
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
