import { defineConfig } from 'vite';

// ponytail: lib-mode ESM, no externals — the trusted loader wraps `dist/index.js`
// in a blob URL and `import()`-s it. Blob URLs have no path, so relative/remote
// imports won't resolve; everything (incl. @viz-js/viz's inlined wasm) must be
// in this single bundle. React is NOT imported at runtime — components use the
// host's `window.React` global (see src/react.ts), so react is absent from the
// bundle. No @vitejs/plugin-react: the source is plain createElement TS, no JSX.
export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: 'index',
    },
    // Bundle everything; the blob-URL import() must be self-contained.
    rollupOptions: {
      external: [],
      output: { inlineDynamicImports: true },
    },
    target: 'esnext',
    emptyOutDir: true,
  },
});
