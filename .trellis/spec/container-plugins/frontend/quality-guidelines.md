# Quality Guidelines

> Code quality standards for the container-plugins package.

---

## Required Patterns

- Every plugin must have a `template` string — used for slash menu insertion
- Plugin names must be **unique** — enforced by the registry `Map` (last registration wins)
- Components must handle missing `attributes` gracefully — always use `?.` and defaults
- Use `docmd-` CSS class prefix for plugin root elements
- Register all built-in plugins in `registerBuiltinPlugins()` in `index.ts`

---

## Forbidden Patterns

| Pattern | Why | Alternative |
|---------|-----|-------------|
| Side effects in plugin components | Preview pane should be pure render | No API calls, no store access |
| Importing from `@mochi/desktop` | Circular dependency | This package is a leaf |
| Tailwind classes in components | Preview pane has its own CSS | Inline styles + CSS vars |
| Direct DOM manipulation | Breaks React rendering | Use React state |

---

## Testing

No test suite currently exists. When adding tests:
- Render each plugin component with sample `ContainerProps`
- Verify default attribute handling (missing `attributes` should not crash)
- Snapshot test rendered output

---

## Code Review Checklist

- [ ] Plugin exports a `ContainerPlugin` object with all required fields
- [ ] Component handles missing `attributes` with defaults
- [ ] `template` string uses valid `:::directive` syntax
- [ ] CSS classes use `docmd-` prefix
- [ ] No imports from `@mochi/desktop` or other non-leaf packages
- [ ] Plugin registered in `registerBuiltinPlugins()`
- [ ] Inline styles used (no Tailwind)
