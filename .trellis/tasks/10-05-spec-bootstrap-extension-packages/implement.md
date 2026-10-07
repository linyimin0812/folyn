# Implementation Checklist

Execution order matters: config first (so routing works), then moves, then new specs, then stale-ref fixes, then verification.

## 1. Fix `.trellis/config.yaml` packages registry

- Remove `api` key (path `apps/api` is dead)
- Remove `container-plugins` key
- Add keys: `container-extensions` (packages/container-extensions), `extension-sdk` (packages/extension-sdk), `extension-host` (packages/extension-host), `create-folyn-extension` (packages/create-folyn-extension), `extension-dev-skill` (packages/extension-dev-skill)
- `default_package: api` → `default_package: desktop`

## 2. Move api/backend → desktop/backend, delete api/

- `git mv` semantics: move `.trellis/spec/api/backend/*` to `.trellis/spec/desktop/backend/`
- Update index.md if it references old location
- Delete `.trellis/spec/api/frontend/` (N/A redirects, obsolete once key is gone)
- Result: `desktop` package has `backend` + `frontend` layers

## 3. Rewrite container-plugins spec → container-extensions

- Delete `.trellis/spec/container-plugins/` (6 files)
- Create `.trellis/spec/container-extensions/frontend/`:
  - `index.md` — overview: what the package is, imports from SDK, registerBuiltinExtensions
  - `directory-structure.md` — one file per extension in src/extensions/, root index.ts public API, editor-languages/, plantuml/, VaultContext.ts
  - `extension-guidelines.md` (replaces component-guidelines) — ContainerExtension interface (from SDK contracts), naming, icon/label/category, template, hidesInactiveChildren contract, styling (inline styles + CSS vars, no Tailwind in preview pane), slash menu
  - `type-safety.md` — ContainerProps, ContainerCategory, re-exports from SDK
  - `quality-guidelines.md` — required patterns, forbidden imports, registry singleton, stateless renderers
  - Skip hook/state files (carry "N/A" notes inside existing files instead of separate files — fewer files)
- Carry over still-valid patterns from old spec (see research file)

## 4. New spec: extension-sdk

`.trellis/spec/extension-sdk/frontend/`:
- `index.md` — overview: publishable contracts package, runtime-free constraint, peer-type React
- `contracts-guidelines.md` — what belongs here vs host vs app; validateManifest/defineExtension single-source-of-truth with host; manifest rules (kebab-case id, tier, sandbox→html, permissions.ai)
- `type-safety.md` — peer-type-only React imports, ExtensionManifest shape, presentation types
- `quality-guidelines.md` — forbidden: runtime deps, Tauri imports, React runtime imports; verification

## 5. New spec: extension-host

`.trellis/spec/extension-host/frontend/`:
- `index.md` — overview: lifecycle state machine, Tauri-free/React-free, injected hooks
- `lifecycle-guidelines.md` — state machine, transactional activation, AbortSignal, error isolation; design doc § references
- `quality-guidelines.md` — testing with fakes pattern (existing .test.ts), forbidden imports (Tauri, React), capability injection via setHooks/ExtensionApiHandle

## 6. New spec: create-folyn-extension

`.trellis/spec/create-folyn-extension/frontend/`:
- `index.md` + `cli-conventions.md` (merged, or single index with conventions section): tier flag required, template structure, non-TTY behavior

## 7. New spec: extension-dev-skill (pointer only)

`.trellis/spec/extension-dev-skill/index.md` — pointer to package SKILL.md; not application code.

## 8. Fix stale refs in desktop spec

1. `trusted-plugin-rendering.md:167` — path update to `packages/container-extensions/src/extensions/MermaidExtension.tsx`
2. `state-management.md:128` — `@folyn/container-extensions` / `registerBuiltinExtensions()`
3. `quality-guidelines.md:245` — import update
4. `type-safety.md:114` — workspace protocol list update

## 9. Verification

```bash
# No placeholders
grep -R "To be filled\|TODO: fill" .trellis/spec
# Registry entries all point at existing dirs (eyeball against ls)
python3 ./.trellis/scripts/get_context.py --mode packages
# No dangling refs to dead spec dirs
grep -rn "spec/api/\|spec/container-plugins" .trellis/spec/
# Every config package key has a spec dir
ls .trellis/spec/
```

## Rollback

All changes are doc/config-only: `git checkout -- .trellis/spec .trellis/config.yaml` restores everything. No product code touched.
