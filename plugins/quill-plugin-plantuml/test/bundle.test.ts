import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// ponytail: per .trellis/spec/desktop/frontend/trusted-plugin-rendering.md,
// the built bundle MUST contain zero `import` statements and must not
// reference react/jsx-runtime. A blob-URL `import()` cannot resolve bare
// specifiers, and bundling React would cause "Invalid hook call".
// This test is the executable contract — it fails the build otherwise.
describe('bundle self-containedness', () => {
  const bundlePath = resolve(process.cwd(), 'dist/index.js');

  it('dist/index.js exists after build', () => {
    // Skip in CI environments that haven't run `pnpm build` before tests.
    if (!existsSync(bundlePath)) {
      console.warn('[bundle.test] dist/index.js missing — run `pnpm build` first. Skipping.');
      return;
    }
    const code = readFileSync(bundlePath, 'utf8');

    // No import statements (esbuild inlines everything; React is via window.React).
    const importMatches = code.match(/^\s*import\s+/gm) ?? [];
    expect(importMatches, `expected zero import statements, found ${importMatches.length}`).toHaveLength(0);

    // No react/jsx-runtime references (would indicate JSX leaked in).
    expect(code).not.toMatch(/react\/jsx-runtime/);
    expect(code).not.toMatch(/\brequire\s*\(\s*['"]react['"]\s*\)/);

    // Must reference window.React (the contract).
    expect(code).toMatch(/window\.React/);
  });
});
