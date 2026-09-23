import { defineConfig } from 'vitest/config';

// Node environment — the collect() test drives a real temp git repo via
// child_process, so no DOM is needed.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globals: true,
  },
});
