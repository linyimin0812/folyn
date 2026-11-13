import { defineConfig } from 'vitest/config';

// Node environment — collect tests stub ctx.imapFetch with canned messages, no
// DOM needed. The settings form's test opts into jsdom with a file pragma;
// react/react-dom are devDeps so it loads the real modules (the react shim is
// only for the esbuild bundle).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    globals: true,
  },
});
