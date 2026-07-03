import { defineConfig, type UserConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileViewerRenderers } from '@file-viewer/vite-plugin';
import path from 'path';

const host = process.env.TAURI_DEV_HOST;
const isTauri = !!process.env.TAURI_ENV_PLATFORM;

export default defineConfig(() => {
  return {
    plugins: [react(), fileViewerRenderers({ preset: 'office', copyAssets: true })],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
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
        ignored: ['**/src-tauri/**'],
      },
    },
  } satisfies UserConfig;
});
