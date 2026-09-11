import { defineConfig, type UserConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileViewerRenderers } from '@file-viewer/vite-plugin';
import path from 'node:path';

const host = process.env.TAURI_DEV_HOST;
const isTauri = !!process.env.TAURI_ENV_PLATFORM;

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      // The app renders only CSV in-app (office/pdf/archive/cad/… viewing
      // moved to the standalone file-viewer extension, which bundles those
      // renderers + their WASM/workers itself). Keep ONLY the spreadsheet
      // renderer here so CSV preview works; copyAssets copies just the small
      // xlsx sheet worker. No preset — preset-office would pull RTFJS /
      // heic2any / maplibre / pdf.worker / libarchive.wasm / … (~12MB) the app
      // no longer uses.
      fileViewerRenderers({
        renderers: ['spreadsheet'],
        copyAssets: true,
        inject: false,
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    base: isTauri ? '/' : '/folyn',
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
