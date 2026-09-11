import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const extRoot = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.join(extRoot, 'src');
const outDir = path.join(extRoot, 'dist');

/**
 * Iframe bundle for the dbml extension. @dbml/core (antlr4 SQL parser, ~16M)
 * + @antv/x6 run here at the plugin's `folyn-extension://` origin so the
 * bare-specifier dynamic imports resolve. Vite code-splits the heavy deps.
 *
 * Tailwind: load the config at the package root explicitly (vite root is src/,
 * so the postcss tailwind plugin can't auto-discover ../tailwind.config.js and
 * would emit zero classes — ErDiagramX6 is all Tailwind). PostCSS runs inline
 * here with tailwindcss + autoprefixer pointed at that config.
 */
export default defineConfig({
  root: srcRoot,
  base: './',
  plugins: [react()],
  css: {
    postcss: {
      plugins: [tailwindcss({ config: path.join(extRoot, 'tailwind.config.js') }), autoprefixer()],
    },
  },
  build: {
    outDir,
    emptyOutDir: false, // keep the esbuild-produced host index.js
    target: 'es2022',
    rollupOptions: {
      input: path.join(srcRoot, 'dbml-preview.html'),
    },
    chunkSizeWarningLimit: 4000,
  },
});
