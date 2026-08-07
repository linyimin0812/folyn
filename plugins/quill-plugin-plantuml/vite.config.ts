import { defineConfig } from 'vitest/config';

// ponytail: single config file for tests. No @vitejs/plugin-react — plugin
// source uses window.React at runtime; tests provide window.React via
// setup.ts (assigning the workspace's react instance to jsdom's window).
export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
  },
});
