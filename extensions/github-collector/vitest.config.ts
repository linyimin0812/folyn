import { defineConfig } from 'vitest/config';

// Node environment — tests stub ctx.http with fixture JSON, no DOM needed.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globals: true,
  },
});
