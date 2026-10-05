# Quality Guidelines

> Code quality standards for the container-extensions package.

---

## Required Patterns

- Every extension must have a `template` string — used for slash menu insertion
- Extension `name`s must be **unique** — the registry `OwnedRegistry` keys by name; last registration with the same key replaces the earlier one
- Components must handle missing `attributes` gracefully — always `?.` plus a default
- Root elements use the `docmd-` CSS class prefix
- Register every built-in extension in `registerBuiltinExtensions()` in the root `index.ts`
- Extensions that hide inactive children set `hidesInactiveChildren: true` (see [Extension Guidelines](./extension-guidelines.md))

## Forbidden Patterns

| Pattern | Why | Alternative |
|---------|-----|-------------|
| Side effects in components | Preview pane must be pure render | Render-local state only |
| Importing from `@folyn/desktop` or `apps/desktop` | Circular dependency; this package is a leaf consumed by the app | `VaultContext` for vault access |
| Tailwind classes in components | Preview pane has its own CSS | Inline styles + CSS vars |
| Direct DOM manipulation | Breaks React rendering | React state |
| Importing contracts from anywhere except `folyn-extension-sdk` / `./ContainerExtension` | Contracts have one source of truth | SDK re-exports |

## Ownership

Registration carries an `ownerExtensionId` (default `FOLYN_CORE_OWNER` from the SDK). External extensions register their containers into the same singleton and are bulk-removed via `removeByOwner` on reload/deactivate — never manually unregistered by name. Do not add runtime add/remove reactivity: the registry is read during render, built-ins register once at load (see `.trellis/spec/desktop/frontend/state-management.md` for the desktop-side rationale).

## Testing

Co-located vitest files are the established pattern:

- `src/ContainerRegistry.test.ts` — singleton identity, register/get/has/unregister, ownership
- `src/ContainerExtension.test.ts` — shape of every built-in against the `ContainerExtension` contract, category union
- `src/plantuml/encode.test.ts`, `src/editor-languages/dot.test.ts`, `src/editor-languages/plantuml.test.ts` — encoding and tokenizer behavior

When adding an extension: extend the `ContainerExtension.test.ts` coverage (fields present, category valid, template parses as the directive's own syntax).

## Code Review Checklist

- [ ] Extension exports a `ContainerExtension` object with all required fields, annotated
- [ ] Component handles missing `attributes` with defaults
- [ ] `template` string uses valid `:::directive` syntax
- [ ] CSS classes use `docmd-` prefix; inline styles only
- [ ] Hiding containers/children set `hidesInactiveChildren`
- [ ] No imports from `@folyn/desktop` or other non-leaf code
- [ ] Extension registered in `registerBuiltinExtensions()`
- [ ] Co-located `.test.ts` updated
