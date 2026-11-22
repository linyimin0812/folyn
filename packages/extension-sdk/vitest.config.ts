import { defineConfig } from 'vitest/config';

// The build helpers run in Node (esbuild); their test bundles a component and
// renders it in jsdom (file pragma).
export default defineConfig({
  test: {
    include: ['build/**/*.test.ts'],
  },
});
