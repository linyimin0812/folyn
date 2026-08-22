import { defineConfig, type UserConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileViewerRenderers } from '@file-viewer/vite-plugin';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);

const host = process.env.TAURI_DEV_HOST;
const isTauri = !!process.env.TAURI_ENV_PLATFORM;

// ponytail: dwg-worker.js (132KB module worker) resolves its sibling libredwg-web.js
// via location.origin + /wasm/libredwg-web.js, so both must be same-origin. The 6MB
// libredwg-web.wasm stays on CDN via wasmPath in OfficeFileViewer. If the package
// is absent (resolution fails), the plugin is a no-op so non-CAD builds don't break.
function copyCadWorkerAssets() {
  let srcDir: string;
  try {
    srcDir = path.join(path.dirname(require.resolve('@flyfish-dev/cad-viewer/package.json')), 'dist/wasm');
  } catch {
    return { name: 'copy-cad-worker-assets' };
  }
  const files = ['dwg-worker.js', 'libredwg-web.js'];
  return {
    name: 'copy-cad-worker-assets',
    configureServer() {
      const dest = path.resolve(__dirname, 'public/wasm');
      fs.mkdirSync(dest, { recursive: true });
      files.forEach((f) => fs.copyFileSync(path.join(srcDir, f), path.join(dest, f)));
    },
    closeBundle() {
      const dest = path.resolve(__dirname, 'dist/wasm');
      fs.mkdirSync(dest, { recursive: true });
      files.forEach((f) => fs.copyFileSync(path.join(srcDir, f), path.join(dest, f)));
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      // ponytail: preset-all pulls typst (39MB WASM+fonts) we don't use; base on
      // preset-office and explicitly add only the renderer lines we want. typst
      // is omitted so copyAssets skips dist/wasm/typst. CAD (~6.9MB WASM) and
      // media (hls.js/tonejs ~1MB) are loaded from jsDelivr at runtime when a
      // .dwg/.mp4/etc. file opens — see OfficeFileViewer.tsx CDN import logic.
      fileViewerRenderers({
        preset: 'office',
        renderers: ['archive', 'email', 'eda', 'geo', 'model', 'drawing', 'mindmap', 'ebook', 'image', 'data'],
        copyAssets: true,
        inject: false,
      }),
      copyCadWorkerAssets(),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        // ponytail: epubjs imports `jszip/dist/jszip` (legacy bundle path removed in jszip 3.x); alias to the package entry so vite resolves it.
        'jszip/dist/jszip': 'jszip',
      },
    },
    base: isTauri ? '/' : '/quill',
    clearScreen: false,
    build: {
      target: 'esnext',
      minify: 'terser',
      terserOptions: {
        compress: {
          drop_console: true,
          drop_debugger: true,
        },
      },
      rollupOptions: {
        output: {
          manualChunks: {
            'codemirror': ['@codemirror/autocomplete', '@codemirror/commands', '@codemirror/lang-markdown', '@codemirror/language', '@codemirror/lint', '@codemirror/search', '@codemirror/state', '@codemirror/view'],
            'rehype': ['rehype-highlight', 'rehype-react', 'rehype-raw', 'remark-gfm', 'remark-parse', 'remark-directive', 'remark-rehype', 'unified'],
            'grapesjs': ['grapesjs'],
            // PR4-6: heavy JSON-viewer libs are split into their own chunks so
            // the initial bundle stays small. Each is dynamically imported
            // only when its tab is engaged, so these chunks load on demand.
            'jq-wasm': ['jq-wasm'],
            'exceljs': ['exceljs'],
            'jsondiffpatch': ['jsondiffpatch'],
          },
        },
      },
      chunkSizeWarningLimit: 600,
    },
    server: {
      port: 1420,
      strictPort: true,
      host: host || '0.0.0.0',
      allowedHosts: true as const,
      hmr: host
        ? { protocol: 'ws', host, port: 1421 }
        : undefined,
      proxy: {},
      watch: {
        // ponytail: public/vendor and public/wasm hold immutable third-party binary
        // assets (pdf.js .bcmap cmaps, fonts, .wasm, workers). On Windows, fs.watch
        // hits EBUSY on these locked files and crashes the chokidar watcher, taking
        // down the dev server. They never change during dev, so exclude them.
        ignored: ['**/src-tauri/**', '**/public/vendor/**', '**/public/wasm/**'],
      },
    },
  } satisfies UserConfig;
});
