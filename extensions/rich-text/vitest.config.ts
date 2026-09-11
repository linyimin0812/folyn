import { defineConfig } from 'vitest/config';
import path from 'node:path';

// ponytail: minimal vitest config — jsdom for the React/DOM-touching tests
// (RichTextToolbar / RichTextSlashMenu / richtextHtml export). The host's
// vitest workspace already includes extensions; this config makes
// `pnpm --filter @folyn/extension-rich-text test` work standalone. `@/`
// alias is not needed — extension tests use relative imports.
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    globals: true,
  },
  resolve: {
    alias: {
      // ponytail: typecheck resolves react/react-i18next to real packages in
      // node_modules; vitest resolves them the same way (the shim is only
      // for the esbuild bundle, not for tests — tests run in node, not a
      // blob URL). react/react-i18next are devDeps so the test runner can
      // load the real modules.
    },
  },
});
