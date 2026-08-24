# publish plugin-sdk to npm

## Goal

Make `@folyn/plugin-sdk` publishable to the public npm registry so external plugin authors can `npm install @folyn/plugin-sdk` and typecheck their plugin bundles against the public SDK surface. Currently `package.json` points `main`/`types`/`exports` at raw `.ts` source, so a tarball would be un-consumable without our TS toolchain. Scope: public npm only (GitHub Packages = follow-up).

## Requirements

- `packages/plugin-sdk/package.json` rewritten so the published tarball is consumable:
  - `main: "./dist/index.js"`, `types: "./dist/index.d.ts"`.
  - `exports["."]` = `{ "types": "./dist/index.d.ts", "import": "./dist/index.js" }`.
  - `files: ["dist", "README.md"]` (excludes `src/`, `*.ts` from tarball).
  - `scripts.prepublishOnly: "tsc"` so a build always runs before publish.
  - `publishConfig: { "access": "public" }` (scoped packages default to restricted).
  - Keep `peerDependencies: { react: "^18.0.0" }` (SDK only uses React types).
  - Bump `version: "0.1.0"` (already correct for first release).
- `packages/plugin-sdk/README.md` written — explains what the SDK is, install snippet, links back to repo + plugin-development.md.
- `.gitignore` adds `packages/plugin-sdk/dist/` (build artifact, not source).
- No new runtime dependency; reuse `tsc` already in `devDependencies`.
- ESM-only emit (Node CJS consumers out of scope — SDK is bundler-consumed).

## Acceptance Criteria

- [ ] `pnpm --filter @folyn/plugin-sdk build` produces `dist/index.js` + `dist/index.d.ts` (+ maps).
- [ ] `cd packages/plugin-sdk && npm pack` produces a tarball that:
  - Excludes `src/*.ts` and `index.ts` (root barrel).
  - Includes `dist/`, `README.md`, `package.json`.
  - Tarball `--dry-run` log shows the right file list.
- [ ] Smoke test: a fresh empty dir with `npm init -y` + `npm install <tarball-path>` + a `test.ts` doing `import type { PluginManifest } from '@folyn/plugin-sdk'` then `tsc` passes against the installed `.d.ts` (no `react` import errors thanks to peer dep).
- [ ] After user runs `npm login` + `npm publish --access public`, `npm view @folyn/plugin-sdk` returns 200 with the version.

## Definition of Done

- Repo-side prep done by AI: package.json + README + .gitignore.
- `npm pack` dry-run verified locally.
- Smoke test verified locally.
- Actual `npm publish` is run BY THE USER (needs their npm credentials) — AI does not run publish.
- Docs: `docs/plugin-development.md` "Install the SDK" section updated to reflect `npm install @folyn/plugin-sdk` is now available (vs. pnpm workspace).

## Technical Approach

### Build output

Plain `tsc` against the existing `tsconfig.json` (which extends `../../tsconfig.base.json` with `declaration: true` + `declarationMap: true` + `sourceMap: true`, `outDir: "./dist"`). No bundler added. Output:
```
dist/
  index.js          (ESM)
  index.d.ts
  index.d.ts.map
  index.js.map
  src/
    contracts.d.ts (+ .map)
    definePlugin.d.ts (+ .map)
    Disposable.d.ts (+ .map)
    types.d.ts (+ .map)
```

### package.json shape

```json
{
  "name": "@folyn/plugin-sdk",
  "version": "0.1.0",
  "description": "...",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "default": "./dist/index.js"
    }
  },
  "files": ["dist", "README.md"],
  "scripts": {
    "build": "tsc",
    "prepublishOnly": "tsc",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "clean": "rm -rf dist"
  },
  "peerDependencies": { "react": "^18.0.0" },
  "devDependencies": { "@types/react": "^18.3.12", "react": "^18.3.1", "typescript": "^5.7.0" },
  "publishConfig": { "access": "public" }
}
```

### Publish flow (user-driven)

1. (AI) Prep `package.json` + `README.md` + `.gitignore` + commit.
2. (AI) Verify: `pnpm build` + `npm pack --dry-run` + smoke test.
3. (User) `npm login` (one-time per machine).
4. (User) `cd packages/plugin-sdk && npm publish --access public`.
5. (AI, post-publish) Update `docs/plugin-development.md` install snippet if needed; verify `npm view @folyn/plugin-sdk`.

## Decision (ADR-lite)

**Context**: SDK is currently raw TS source — published tarball would be un-consumable. Need to publish to npm so external plugin authors can install it. User wants public npm (GitHub Packages follow-up). Brand scope `@folyn` is unclaimed on npm — first publish auto-binds it to the publishing account.

**Decision**: Plain `tsc` build (no bundler), ESM-only, scoped `@folyn/plugin-sdk` with `access: public`, manual `npm publish` run by the user (AI prepares everything up to that point).

**Consequences**: External plugin authors get types + ESM via `npm install @folyn/plugin-sdk`. Node CommonJS consumers can't `require()` it — out of scope, the SDK is bundler-consumed (Vite/webpack). GitHub Packages parity is a follow-up (would need a separate scope matching GitHub user `linyimin0812`, or a different publish flow).

## Out of Scope

- GitHub Packages publish (follow-up; needs scope-matching decision).
- CI-driven publish workflow (GitHub Action on tag push — follow-up).
- Changesets / monorepo release tooling — follow-up.
- CJS / UMD dual emit — bundler-consumed ESM is enough.
- Auto-generated typedoc API reference — follow-up.
- Publishing other workspace packages (`plugin-host`, `container-plugins`, `cli-adapter`) — this task is SDK-only.

## Technical Notes

- `tsconfig.base.json` already has `declaration: true` + `declarationMap: true` + `sourceMap: true`; package `tsconfig.json` adds `outDir: "./dist"` + `rootDir: "."` + `jsx: "react-jsx"`.
- Sibling packages (`plugin-host` etc.) import `@folyn/plugin-sdk` via pnpm workspace protocol — they don't see the published artifact; they use the local source. The published artifact is only for EXTERNAL plugin authors.
- `npm publish` for scoped packages defaults to `restricted` (private); `publishConfig.access = "public"` overrides this.
- `prepublishOnly` runs automatically before every `npm publish` — guarantees the build is fresh.
- React `peerDependency` (not `dependencies`) — correct since SDK only uses React types, erased at build.
