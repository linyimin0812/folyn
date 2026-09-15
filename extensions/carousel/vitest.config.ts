import { defineConfig } from 'vitest/config';

// Minimal vitest config so the Carousel component test runs standalone.
// jsdom for the DOM-touching collect/show effects. react/react-dom are
// devDeps so the test runner loads the real modules (the react shim is only
// for the esbuild bundle, not tests).
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    globals: true,
  },
});
