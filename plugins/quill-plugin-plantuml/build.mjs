import esbuild from 'esbuild';

// ponytail: single-file ESM bundle. All deps (plantuml-encoder + its
// transitive deflate/encode64) are inlined. React is NOT bundled — the
// plugin resolves window.React at runtime (host exposes it in main.tsx).
// Per .trellis/spec/desktop/frontend/trusted-plugin-rendering.md, a runtime
// `import 'react'` in a blob-URL plugin fails (no import map on macOS 10.15).
await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  outfile: 'dist/index.js',
  target: 'es2022',
  // No externals — plantuml-encoder inlined. React intentionally NOT imported
  // (we use window.React). If a runtime import of react slips in (e.g. JSX),
  // the bundle will emit `import` statements and the smoke test in
  // test/bundle.test.ts will fail.
  external: [],
  logLevel: 'info',
});

console.log('built dist/index.js');
