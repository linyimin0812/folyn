import { defineConfig } from 'vitest/config';

// Node environment — tests stub ctx.scanVault with fixed snapshots, no DOM.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globals: true,
  },
});
