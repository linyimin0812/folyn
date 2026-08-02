# PRD: Remove auto-sort & auto-copy from JSON file viewer

## Goal
Remove the **自动排序 (auto-sort)** and **自动复制 (auto-copy)** features from the JSON file viewer. These toggles in `PreviewToolbar` add complexity for marginal value — remove them entirely.

## Out of scope
- Manual copy paths (`handleCopyPath` / `handleCopyValue` triggered by clicking tree nodes) — KEEP. Only the auto-copy side-effects die.
- Format button, query, convert, diff features — untouched.

## Changes

### 1. `JsonFileViewerPreview.tsx`
- Remove state: `autoSort`, `autoCopy`.
- Remove import `sortKeysDeep` and its call inside `parse`; `parse` signature drops the `sort` parameter.
- Remove auto-copy side-effect block inside `parse` (the `if (autoCopy) { ... writeText(...) }`).
- Remove `autoCopyIfEnabled` helper; drop its calls in `handleQueryRun` and `handleConvertOutput`. `handleConvertOutput` becomes a noop (or is removed if no other purpose — but it's the `onOutput` prop for `ConvertPanel`; keep as a noop stub or remove the wiring if `ConvertPanel` doesn't require it).
  - Check: `ConvertPanel`'s `onOutput` is called on convert outputs. If `autoCopyIfEnabled` was its only consumer, `onOutput` becomes optional / can be dropped from the call site. Prefer: keep the prop on `ConvertPanel` (minimal change there), just don't wire `onOutput` from `JsonFileViewerPreview` — pass nothing or remove the prop. Decide at implement-time by reading `ConvertPanel`.
- Remove props forwarded to `PreviewToolbar`: `autoSort`, `autoCopy`, `onToggleAutoSort`, `onToggleAutoCopy`.
- Update `useEffect` debounce deps: drop `autoSort` from the dep array; `parse` no longer takes `sort` arg. Initial mount and external `content` change effects: `parse(content, false)` → `parse(content)`.

### 2. `PreviewToolbar.tsx`
- Remove from props: `autoSort`, `autoCopy`, `onToggleAutoSort`, `onToggleAutoCopy`.
- Remove the second `<div className="mx-1 h-4 w-px bg-brd" />` separator + both `ToggleChip` invocations (自动排序 / 自动复制).
- Remove `ToggleChip` component if now unused (it is).

### 3. Delete dead code
- `lib/sortKeysDeep.ts`
- `lib/sortKeysDeep.test.ts`

### 4. Tests
- `JsonFileViewerPreview.test.tsx`:
  - Delete the "sorts keys alphabetically when auto-sort is ON" test case.
  - Update file header comment block: drop the "Toggling auto-sort ON…" line and the PR8 clipboard-wiring mention.
  - Keep the `@tauri-apps/plugin-clipboard-manager` mock — `handleCopyPath` / `handleCopyValue` still dynamically import it.
- `DiffPane.test.tsx`: unrelated — leave the clipboard mock alone (pre-existing, harmless).

## Verification
- `pnpm --filter desktop lint` clean.
- `pnpm --filter desktop typecheck` clean.
- `pnpm --filter desktop test --run JsonFileViewerPreview DiffPane sortKeysDeep` (sortKeysDeep test file deleted; the others should pass).
- Manual: open a `.json` file → toolbar no longer shows 自动排序 / 自动复制 chips; tree, query, convert, diff still work; clicking a tree node still copies.
