# Research: How a Folyn extension provides a file-type icon

- **Query**: How does a Folyn extension wire a file-type icon? Specifically, make the rich-text extension use `apps/desktop/src/assets/icons/richtext.svg` for `.richtext` files in the file tree / tabs.
- **Scope**: internal
- **Date**: 2026-09-13

## TL;DR

- The manifest `FileTypeContribution` type has **no** `icon` field. The manifest top-level `icon?: string` is for the extension's display card in Settings, NOT for the file-tree/tab icon.
- `FileIcon.tsx` resolves extension-registered file types by looking up the `FileTypeHandler.icon` ReactNode on the registry handler (NOT via `EXT_TO_THEME_ICON` / `HANDLER_TO_THEME_ICON` maps, and NOT via the manifest).
- The dbml precedent: `extensions/dbml/src/index.tsx:23` sets `icon: <DbmlIcon />` on the `FileTypeProvider`. `DbmlIcon` (`extensions/dbml/src/icons/DbmlIcon.tsx`) renders `<img src={sqlUrl}>` where `sqlUrl` is the extension's own copy of `sql.svg` (`extensions/dbml/src/icons/sql.svg`), inlined as a data URL by esbuild's `.svg: 'dataurl'` loader (`extensions/dbml/build.mjs:40`).
- The rich-text `provider` at `extensions/rich-text/src/index.tsx:22-28` has **no** `icon` field — that is the gap.
- The rich-text build already has `.svg: 'dataurl'` (`extensions/rich-text/build.mjs:55`), so the same pattern works without any build-config change.

**Recommended fix (smallest diff, dbml-consistent):** copy `apps/desktop/src/assets/icons/richtext.svg` into `extensions/rich-text/src/icons/richtext.svg`, add `extensions/rich-text/src/icons/RichTextIcon.tsx` (mirror of `DbmlIcon.tsx`), add `extensions/rich-text/src/icons/index.ts` barrel, and add `icon: <RichTextIcon />` to the `provider` at `extensions/rich-text/src/index.tsx:22-28`. No host source change. No manifest change.

---

## Findings

### 1. Manifest schema: no `icon` on the file-type contribution

`packages/extension-sdk/src/types.ts`:

`FileTypeContribution` (lines 227-240):

```ts
export interface FileTypeContribution {
  id: string;
  extensions: string[];
  handler: string;
  defaultViewMode?: string;
  supportedViewModes?: string[];
}
```

No `icon` field. The manifest's top-level `icon?: string` (lines 78-83) is explicitly scoped to the extension's display card:

```ts
  /** Optional display icon. Inline `<svg>…</svg>` string, `.svg` file path
   * (resolved by host via `read_extension_file`), or emoji/short text. Mirrors
   * `ContainerContribution.icon`. */
  icon?: string;
  /** Optional one-line human-readable description shown in Settings → Extensions. */
  description?: string;
```

So `manifest.json: "icon": "sql.svg"` in the dbml manifest is the **Settings card** icon, not the file-tree icon. (dbml's `"icon": "sql.svg"` at `extensions/dbml/src/manifest.json:10` is therefore a red herring for this task.)

### 2. Host resolution path: `FileIcon.tsx` reads `handler.icon` from the registry

`apps/desktop/src/components/icons/FileIcon.tsx`, `FileIcon()` (lines 113-155):

1. Lines 119-127 — hardcoded `fileType === 'web' | 'wiki-graph' | 'wiki-query'` → `<img>` from direct asset imports.
2. Line 131 — `ext === 'excalidraw'` → inline `<ExcalidrawIcon>`.
3. Lines 133-134 — `EXT_TO_THEME_ICON[ext]` map → `<ThemeIcon name=...>` if `hasIcon(name)`. This is the **host-owned** path: ext string → theme-icon key → SVG file in `apps/desktop/src/assets/icons/*.svg`.
4. Lines 145-148 — **the extension fallback path**:

```ts
  // ponytail: no built-in ext mapping — consult the registry lazily ...
  const handler = fileType ? getHandlerById(fileType) : getHandlerByExtension(ext);
  // Skip the generic code handler's icon (javaScript) for files that are only
  // recognized as a fallback — use the neutral documentation icon instead.
  if (handler && handler.id !== 'code' && handler?.icon) return <>{handler.icon}</>;
```

So for an extension-registered file type whose ext is NOT in `EXT_TO_THEME_ICON`, the host reads `handler.icon` (a `ReactNode` set by the extension's `FileTypeProvider`) and renders it. This is exactly the path dbml uses.

5. Line 154 — final fallback: `<ThemeIcon name="unknown">` or `<ThemeIcon name="documentation">`.

The `getHandlerByExtension` / `getHandlerById` calls go through `apps/desktop/src/components/file-types/registry.ts` → `HandlerRegistry`, which holds the `FileTypeHandler` objects registered either by built-in `import.meta.glob('./*/index.{ts,tsx}')` (registry.ts:107-114) or by `registerFileTypeHandler` (the extension contribution surface, registry.ts:27-32).

### 3. dbml precedent: extension ships its own icon component

`extensions/dbml/src/index.tsx` (lines 19-31):

```tsx
const provider: FileTypeProvider = {
  id: 'dbml',
  priority: 5000,
  extensions: ['dbml'],
  icon: <DbmlIcon />,            // ← line 23
  needsFileContent: true,
  defaultMode: 'split',
  modes: [ ... ],
};
```

`extensions/dbml/src/icons/DbmlIcon.tsx` (whole file):

```tsx
/** DBML file icon — the app's `sql.svg` (DBML is SQL-flavoured), inlined as
 * a data URL by esbuild's `.svg: 'dataurl'` loader so the host bundle is
 * self-contained (no app assets, no CDN). */
import sqlUrl from './sql.svg';

const S = 16;

export function DbmlIcon(): React.JSX.Element {
  return (
    <img
      src={sqlUrl}
      width={S}
      height={S}
      alt=""
      style={{ display: 'block', flexShrink: 0, width: S, height: S }}
    />
  );
}
```

Barrel: `extensions/dbml/src/icons/index.tsx` → `export { DbmlIcon } from './DbmlIcon';`

SVG asset: `extensions/dbml/src/icons/sql.svg` (a copy of the host's `apps/desktop/src/assets/icons/sql.svg`).

Build config: `extensions/dbml/build.mjs:40` → `loader: { '.svg': 'dataurl' }`. The SVG becomes an inline data URL at build time, so the extension bundle is self-contained.

Note that dbml does NOT rely on the host's `EXT_TO_THEME_ICON` map: `'dbml'` is absent from that map (only `sql: 'sql'` is present at `FileIcon.tsx:38`). It also does NOT rely on the host's `ThemeIcon` component — it renders a plain `<img>` with a build-time data URL. This keeps the extension self-contained (no import from `@/components/icons/ThemeIcon`, no coupling to the host's icon-name registry).

### 4. richtext.svg consumption: it is NOT currently consumed anywhere

`apps/desktop/src/assets/icons/richtext.svg` exists (1850 bytes). But:

- `Grep` for `richtext.svg` across the repo (excluding `docs/index.html` which is a marketing page that references `assets/icons/richtext.svg` directly): **no source consumer**.
- `Grep` for `richtext` in `apps/desktop/src/components/icons/`: no matches.
- The `ThemeIcon` component (`apps/desktop/src/components/icons/ThemeIcon.tsx:4-8`) auto-discovers SVGs via `import.meta.glob('../../assets/icons/*.svg', { eager: true, query: '?raw', import: 'default' })` and keys them by file basename minus `.svg`. So the name `'richtext'` IS registered in `iconMap`, and `hasIcon('richtext')` returns `true`. BUT nothing currently asks for `ThemeIcon name="richtext"`: neither `EXT_TO_THEME_ICON` nor `HANDLER_TO_THEME_ICON` maps contain `richtext` (Phase 3 removed them), and no extension provider sets `icon: <ThemeIcon name="richtext" />`.

So the SVG file is present and ThemeIcon-discoverable, but unused. The host-owned path (option B in the task) would just be re-adding `richtext: 'richtext'` / `'rich-text': 'richtext'` to the two maps in `FileIcon.tsx`. That works and is a 2-line diff, but it re-centralizes the rich-text icon in host source — the opposite of Phase 3's relocation intent, and inconsistent with how dbml (a trusted-tier sibling extension) wires its icon.

### 5. Recommended fix: mirror dbml (extension-owned icon component)

The dbml-consistent, Phase-3-honoring fix is to set `icon` on the rich-text `FileTypeProvider`, using an extension-local copy of the SVG. Concretely:

1. Copy `apps/desktop/src/assets/icons/richtext.svg` → `extensions/rich-text/src/icons/richtext.svg`.
2. Create `extensions/rich-text/src/icons/RichTextIcon.tsx` (mirror of `extensions/dbml/src/icons/DbmlIcon.tsx`, swap `sqlUrl` → `richtextUrl`, `sql.svg` → `richtext.svg`).
3. Create `extensions/rich-text/src/icons/index.ts` barrel: `export { RichTextIcon } from './RichTextIcon';`
4. Edit `extensions/rich-text/src/index.tsx` (lines 22-28): add `icon: <RichTextIcon />` to the `provider` object, and add an `import { RichTextIcon } from './icons';` near the existing imports (around line 17-20).

No host source edits. No manifest edits. No build-config edits (`extensions/rich-text/build.mjs:55` already has `loader: { '.svg': 'dataurl' }`).

Verification path: after the edit, a `.richtext` file in the file tree hits `FileIcon.tsx:145` (`getHandlerByExtension('richtext')` → returns the rich-text provider whose `icon` is now set), line 148 renders `<>{handler.icon}</>` = `<RichTextIcon />` = `<img src="data:image/svg+xml;...">` from the inlined `richtext.svg`.

#### Files to create / edit (exact paths)

- CREATE `extensions/rich-text/src/icons/richtext.svg` (copy of `apps/desktop/src/assets/icons/richtext.svg`)
- CREATE `extensions/rich-text/src/icons/RichTextIcon.tsx` (copy `extensions/dbml/src/icons/DbmlIcon.tsx`, swap names)
- CREATE `extensions/rich-text/src/icons/index.ts` (one line: `export { RichTextIcon } from './RichTextIcon';`)
- EDIT `extensions/rich-text/src/index.tsx`: add import + add `icon: <RichTextIcon />` to the `provider` literal at lines 22-28

#### Why not the host-map revert (option B)

Re-adding `richtext: 'richtext'` / `'rich-text': 'richtext'` to `apps/desktop/src/components/icons/FileIcon.tsx` `EXT_TO_THEME_ICON` + `HANDLER_TO_THEME_ICON` is a 2-line diff and uses the existing host-owned `richtext.svg`. It would work. But:

- It re-couples the rich-text icon to host source — the exact coupling Phase 3 was removing (per task context: "Phase 3 removed `richtext: 'richtext'` ... from `FileIcon.tsx`").
- It is inconsistent with dbml, which wires via `provider.icon` + an extension-local SVG, not via the host maps.
- dbml is explicitly the reference trusted-tier extension per the task.

Per ponytail: smallest diff that is also a root-cause fix. The root cause is "the rich-text `FileTypeProvider` is missing its `icon` field" — not "the host maps are missing an entry". The dbml-shaped fix is 4 files (3 new, 1 edit) but each is tiny and the pattern already exists one directory over.

#### Why not manifest `icon` field (option A)

The manifest `icon` field is consumed for the Settings → Extensions display card (per `types.ts:78-83`). `FileIcon.tsx` never reads `manifest.icon`. So adding `"icon": "richtext.svg"` to `extensions/rich-text/src/manifest.json` would not affect file-tree icons. (If you also want the Settings card icon, you can add it independently — but it's a separate concern from this task.)

### Related specs

- `.trellis/spec/desktop/` — desktop app specs (host source of `FileIcon.tsx`, `ThemeIcon.tsx`, `registry.ts`).
- `.trellis/spec/api/` — extension SDK contract (`packages/extension-sdk/src/types.ts`).

## Caveats / Not Found

- I did not find a `THEME_ICONS` constant map; theme icons are auto-discovered via `import.meta.glob` in `apps/desktop/src/components/icons/ThemeIcon.tsx:4-8`, keyed by SVG file basename. So adding a new SVG to `apps/desktop/src/assets/icons/` automatically registers it under its base name; no host-side string map to update.
- The `manifest.icon` consumption site (Settings → Extensions card) was not located in this search — out of scope for this task, but worth noting it exists separately from the file-type icon.
- `extensions/rich-text/build.mjs:55` confirms `.svg: 'dataurl'` is already configured, so the SVG import in the new `RichTextIcon.tsx` will resolve without a build-config edit.
- I did not run the build to confirm the data URL is produced; this is inferred from the identical pattern in `extensions/dbml/` which uses the same loader.
