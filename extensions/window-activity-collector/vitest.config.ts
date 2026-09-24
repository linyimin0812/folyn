import { defineConfig } from 'vitest/config';

// Node environment — tests stub ctx.frontWindow with fixed samples, no DOM.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globals: true,
  },
});
