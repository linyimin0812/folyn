# Add test coverage across project

## Goal

Bring meaningful test coverage to the Folyn monorepo. Today only the GrapesJS HTML editor area has tests (4 files in `apps/desktop/src/components/file-types/html/`). Everything else — utils, services, stores, hooks, and the three workspace packages (`cli-adapter`, `container-plugins`, `vault-provider`) — is uncovered. We want a baseline that catches regressions and documents intent, without chasing a coverage number.

## Requirements

- **Scope**: full monorepo — `apps/desktop` + `packages/{cli-adapter, container-plugins, vault-provider}`. `apps/api` has no source, excluded.
- **Depth**: unit tests only. React component rendering, CodeMirror/GrapesJS editor integration, and E2E are out. Pure helpers exported from `.tsx` files may be tested as units.
- **Test runner**: consolidate to a single root-level **Vitest workspace** config (`vitest.workspace.ts` at repo root). Remove `apps/desktop/vitest.config.ts`, the `test`/`test:watch` scripts, and the vitest/jsdom/happy-dom/coverage-v8 devDeps from `apps/desktop/package.json`. Move them to root `package.json` + root `devDependencies`.
- **Root scripts**: add `pnpm test` (`vitest run`) and `pnpm test:watch` at root. Keep `pnpm -r lint` / `pnpm -r clean` as-is.
- **Tauri mocking**: provide a shared mock set under `test/mocks/@tauri-apps/` (covering `api`, `plugin-fs`, `plugin-shell`, `plugin-dialog`) wired in via a root `test/setup.ts`. Individual tests use the shared mocks; no per-file `vi.mock('@tauri-apps/...')`.
- **Existing 4 GrapesJS tests** must still pass under the new root config.
- **No coverage threshold** enforced; coverage is reported for visibility only when `--coverage` is passed.

## Acceptance Criteria

- [ ] Root `vitest.workspace.ts` defines projects for desktop + 3 packages; `pnpm test` is green from a clean checkout.
- [ ] `apps/desktop/vitest.config.ts` and its vitest-related `package.json` entries are removed; desktop still builds (`pnpm build`).
- [ ] `test/mocks/@tauri-apps/{api,plugin-fs,plugin-shell,plugin-dialog}.ts` exist and are loaded via `test/setup.ts`.
- [ ] Desktop unit tests cover primary happy path + key edge cases for:
  - `utils/`: `markdownUtils`, `pathResolver`, `treeUtils`, `idGenerator`, `platform`, `sessionStorage`, `storageClient`.
  - `services/`: `clipService`, `exportService`, `aiStreamUtils`, `graphDataBuilder`, `wikiLintService`, `wikiQueryService`, `skillDefaults`.
  - `store/`: `editorStore`, `vaultStore`, `aiStore`, `searchStore`, `clipStore`, `settingsStore`, `wikiStore`, `wikiGraphStore`, `analysisStore`, `skillStore`.
  - `hooks/`: `useExport`, `useTheme` (tested as pure store interactions, no React render).
  - `components/file-types/html/`: existing 4 tests stay green.
- [ ] `packages/cli-adapter`: tests for `registry`, `baseAdapter`, `claudeAdapter`.
- [ ] `packages/container-plugins`: tests for `ContainerRegistry`, `ContainerPlugin` contract.
- [ ] `packages/vault-provider`: tests for `vaultManager`, `registry`.
- [ ] `pnpm lint` still green; `pnpm build` still green.

## Definition of Done

- Tests added per AC above.
- `pnpm test`, `pnpm lint`, `pnpm build` all green from clean checkout.
- No behavior changes to production code beyond light mock seams (if any); documented in PR descriptions.
- Existing GrapesJS tests unaffected.

## Technical Approach

**Test runner consolidation**
- Root `package.json`: add `vitest`, `@vitest/coverage-v8`, `jsdom`, `happy-dom` to root `devDependencies`; add `"test": "vitest run"`, `"test:watch": "vitest"`.
- Root `vitest.workspace.ts`: array of project globs, each pointing at a package root with its own minimal `tsconfig` reference. Use `environment: 'jsdom'` globally; projects can override.
- Remove `apps/desktop/vitest.config.ts`; remove `test`, `test:watch`, `vitest`, `@vitest/coverage-v8`, `jsdom`, `happy-dom` from `apps/desktop/package.json`.

**Tauri shared mocks**
- `test/mocks/@tauri-apps/api.ts`: stub `invoke`, `convertFileSrc`, event APIs.
- `test/mocks/@tauri-apps/plugin-fs.ts`: in-memory FS map; `readTextFile`/`writeTextFile`/`exists`/`removeDir`/`readDir` operate on the map.
- `test/mocks/@tauri-apps/plugin-shell.ts`: stub `Command` with a fake stdout/exit code.
- `test/mocks/@tauri-apps/plugin-dialog.ts`: stub `open`/`save` returning canned paths.
- `test/setup.ts`: `vi.mock('@tauri-apps/api', ...)` etc., reset state before each test.
- `vitest.workspace.ts` references `test/setup.ts` as `setupFiles`.

**Desktop test layout**
- Co-locate tests next to source (matches existing GrapesJS pattern): `foo.ts` → `foo.test.ts`.
- Stores: drive via `getState()`/`setState()`/actions; no React.
- Services: inject mock Tauri FS where needed; assert on returned data and side-effects to the mock FS.
- Utils: pure-function tests, no mocks.

**Package test layout**
- Same co-location pattern. Each package's `tsconfig.json` already builds TS; vitest resolves via the root workspace config.

## Decision (ADR-lite)

**Context**: Desktop already has vitest configured, but only 4 tests exist. Three packages have no test runner. We want one consistent test setup across the monorepo without duplicating config per package.

**Decision**: Consolidate to a root-level Vitest workspace. Remove the desktop-specific vitest config and devDeps. Use a shared Tauri mock set loaded via a root setup file. Unit-test only.

**Consequences**:
- + One place to maintain test config; adding a new package means adding one entry to `vitest.workspace.ts`.
- − Desktop loses its local `test` script; devs must run from root. Acceptable for a monorepo.
- − Shared Tauri mocks may drift from real API surface; mitigated by type-only imports of `@tauri-apps/*` types in the mock files so TS flags mismatches.
- − Unit-only means UI regressions in React components won't be caught; explicit out-of-scope, follow-up task if needed.

## Out of Scope

- E2E / Playwright tests of the Tauri app.
- Tests for `apps/api` (no source).
- React component render tests (RTL), snapshot tests, CodeMirror/GrapesJS editor integration tests.
- Coverage threshold CI gates.
- Refactoring production code beyond adding light DI seams if a module is hard to test (won't refactor just for coverage).
- `src/components/icons/`, `src/assets/`, `src/types/`, `src/editor/extensions/` (CodeMirror config) — low unit-test value.

## Technical Notes

- desktop vitest config: `apps/desktop/vitest.config.ts` (alias `@` → `src/`, jsdom env) — to be deleted; alias moves to root workspace config.
- Existing GrapesJS tests use jsdom + alias `@`; both must work under new root config.
- Zustand stores: test via `setState`/`getState` directly, no React rendering needed.
- Markdown pipeline (remark/rehype) is pure — easy to test with fixture strings.
- Tauri API surface to mock is small (`invoke`, `convertFileSrc`, event bus) plus per-plugin functions.
