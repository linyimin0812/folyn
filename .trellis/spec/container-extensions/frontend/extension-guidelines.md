# Extension Guidelines

> How to write a container extension (the `ContainerExtension` pattern).

---

## The interface

`ContainerExtension` is defined in `folyn-extension-sdk` (`packages/extension-sdk/src/contracts.ts`) and re-exported through `packages/container-extensions/src/ContainerExtension.ts`. Required fields:

| Field | Meaning |
|-------|---------|
| `name` | Directive name — the word after `:::`; must be unique registry-wide |
| `icon` | Emoji or icon for the slash menu |
| `label` | Human-readable label |
| `category` | Slash-menu grouping: `'layout' \| 'media' \| 'ai' \| 'data' \| 'custom'` |
| `component` | React component `(props: ContainerProps) => ReactNode` |
| `template` | Markdown string inserted when selected from the slash menu |
| `description?` | Optional slash-menu hint |
| `hidesInactiveChildren?` | See contract below |

Reference implementation: `packages/container-extensions/src/extensions/CalloutExtension.tsx`.

## File + export naming

- File: `src/extensions/<Name>Extension.tsx` (e.g. `CalloutExtension.tsx`)
- Export: `export const calloutExtension: ContainerExtension = { ... }`
- A parent + its child directive live in one file (`TabsExtension.tsx` exports both `tabsExtension` and `tabExtension`)

## The `hidesInactiveChildren` contract

Set `hidesInactiveChildren: true` on:

- a container that shows only one of its children at a time (e.g. `tabs`), or
- a child directive that renders `display:none` until its parent reveals it (e.g. `tab`)

The host's cursor-sync reads this flag: it skips stamping `data-source-line` on such children (a hidden child is a 0-height locatable block → drift) and promotes the cursor target to the nearest hiding parent. The flag is declared at the definition site — a new container of this shape just sets the flag, no host-side allowlist. See `TabsExtension.tsx` (both `tabsExtension` and `tabExtension` set it) and the JSDoc on `contracts.ts:80`.

## Styling

Inline styles + CSS variables; **no Tailwind** — the preview pane is a separate rendering context with its own CSS.

- Root element class: `docmd-<name>` (e.g. `docmd-callout`)
- Theme colors: CSS variables with a literal fallback, e.g. `color: 'var(--t2, #3f3f46)'` (`CalloutExtension.tsx`)
- Variant maps: plain `Record<string, ...>` constants keyed by attribute value (`CALLOUT_VARIANTS` in `CalloutExtension.tsx`)

## Attributes

Directive attributes arrive as `props.attributes?.type` — an optional record. Always read with `?.` and provide a default:

```ts
const type = attributes?.type || 'info';
```

## Vault access

Extensions needing filesystem access (e.g. `file-preview`) read `useVaultContext()` from `src/VaultContext.ts` — never import Tauri or desktop stores directly. The desktop preview host supplies the context value (`vaultRoot`, `filePath`, `readFile`, optional `renderFile`/`openFile`/`getFileIcon`); it is `null` when no host is available, so guard usage. `FilePreviewExtension.tsx` is the reference.

## State

Components are stateless renderers: local `useState`/`useEffect` for render-local concerns (e.g. `MermaidExtension`'s SVG cache) is fine; no stores, no API calls, no side effects beyond rendering. Async renderers follow the `useMermaidSvg` / `usePlantUmlSvg` / `useGraphvizSvg` hook shape (source → Promise<string> → state).

## Slash menu

The `template` string is what the slash menu inserts on selection. It must be valid markdown using the directive's own syntax:

```ts
template: ':::callout{type="info" title="提示"}\n在此输入内容\n:::'
```

Parent containers that need child directives put them in the template (`TabsExtension.tsx`'s `::::tabs` template).
