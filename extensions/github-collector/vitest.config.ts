import { defineConfig } from 'vitest/config';

// Node environment — tests stub api.network.fetch with fixture JSON, no DOM needed.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globals: true,
  },
});
