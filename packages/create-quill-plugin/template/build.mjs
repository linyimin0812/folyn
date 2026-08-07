import esbuild from 'esbuild';

// ponytail: single-file ESM bundle. All deps are inlined. React is NOT
// bundled — the plugin resolves window.React at runtime (host exposes it
// in main.tsx before any trusted plugin is import()-ed).
await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  outfile: 'dist/index.js',
  target: 'es2022',
  external: [],
  logLevel: 'info',
});

console.log('built dist/index.js');
