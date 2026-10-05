# Type Safety

> Type patterns for the folyn-extension-sdk package.

---

## React as a peer type only

React appears in the SDK **as types, never at runtime**:

```ts
import type { ComponentType, ReactNode } from 'react';
```

`presentation.ts` and `contracts.ts` do exactly this (see the `presentation.ts` header comment: "React appears as a peer type only ... type-only imports of `react` are erased at build, so the SDK has no runtime dep"). `react` sits in `peerDependencies` and `devDependencies` (for `@types/react`), never in `dependencies`. A value import of React (`import { useState } from 'react'`) is a build-breaking mistake — the published package would drag a runtime dependency.

The same rule applies to any future UI library reference in contract types: type-only import, peer type, erased at build.

## ExtensionManifest shape

`ExtensionManifest` (`types.ts:57`) is the root contract: `id`, `version`, `tier: 'sandbox' | 'trusted'`, `main`, optional `html` (required for sandbox), `permissions` (incl. the `ai` sub-shape), and `contributes` maps for commands, fileTypes, containers, features, tools, exporters, fileTemplates, keybindings, exportEnhancers, markdownCodeRenderers, editorLanguages, highlightGrammars. All entry references inside `contributes` are strings.

## Presentation model types

`presentation.ts` (file presentation model, doc §11–§14, §43):

- `PresentationModeId` — `'edit' | 'split' | 'preview'` plus an open string tail `(string & {})`
- `PresentationModeRegistration` — declarative mode: `kind` (`shell-editor | component | split`) + optional component, **not** a `create(ctx)` factory
- `SplitComposition` — a composition of two sibling mode ids; the shell owns the layout
- `FilePresentationContext` — the props bundle the shell hands a mode's component (content / cursor-sync / signal); subsumes the legacy `EditorProps`/`PreviewProps`
- `FileTypeProvider`, `IconRef`, `ViewMode`

The declarative-modes decision is deliberate — keep new presentation types declarative so shell resolution stays a `switch(kind)`.

## Ownership types

`registry.ts`: `FOLYN_CORE_OWNER` (`'folyn.core'`), `Registry<T>`, and `OwnedRegistry<T>` keyed by name and tracking `ownerExtensionId` per entry. `Disposable.ts` provides the `{ dispose(): void }` type + `DisposableStore`. Extension-owned contributions use these; host-boot singletons (capability providers, contribution adapters) deliberately do not.
