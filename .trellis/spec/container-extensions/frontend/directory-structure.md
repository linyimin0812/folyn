# Directory Structure

> Module layout of `packages/container-extensions/`.

---

## Layout

```
packages/container-extensions/
├── index.ts                  # Public API: contract re-exports + registerBuiltinExtensions()
└── src/
    ├── ContainerExtension.ts  # Re-exports ContainerProps/ContainerCategory/ContainerExtension from folyn-extension-sdk
    ├── ContainerRegistry.ts   # Singleton registry (OwnedRegistry-backed)
    ├── VaultContext.ts        # Ambient vault state context + useVaultContext
    ├── extensions/            # One file per built-in extension (13 files)
    ├── editor-languages/      # CodeMirror StreamLanguage factories (mermaid, plantuml, dot)
    └── plantuml/
        └── encode.ts          # PlantUML text encoding (server URL form)
```

Tests are co-located next to the module they test (`src/ContainerRegistry.test.ts`, `src/ContainerExtension.test.ts`, `src/plantuml/encode.test.ts`, `src/editor-languages/dot.test.ts`, `src/editor-languages/plantuml.test.ts`) and run with vitest.

## One file per extension

Every container directive gets exactly one file in `src/extensions/`, named `<Name>Extension.tsx`:

- `CalloutExtension.tsx` — `callout`
- `TabsExtension.tsx` — `tabs` + `tab` (parent + child directive in one file)
- `MermaidExtension.tsx` — `mermaid` (exports `MermaidBlock`, `useMermaidSvg`)
- `PlantUmlExtension.tsx` — `plantuml` (exports `PlantUmlBlock`, `usePlantUmlSvg`)
- `GraphvizExtension.tsx` — `graphviz` (exports `GraphvizBlock`, `useGraphvizSvg`)
- `StatusTagExtension.tsx` — `status-tag`
- `TimelineExtension.tsx` — `timeline`
- `FilePreviewExtension.tsx` — `file-preview` (uses `VaultContext`)
- `StepsExtension.tsx` — `steps` + `step`
- `CollapsibleExtension.tsx` — `collapsible`
- `CardExtension.tsx` — `card`
- `GridExtension.tsx` — `grid`
- `ButtonExtension.tsx` — `button`

Each file exports a named `<name>Extension` constant. New extensions: add the file, then one `registry.register(...)` line in `registerBuiltinExtensions()` in the root `index.ts`.

## Root index.ts is the public API

`packages/container-extensions/index.ts` re-exports contracts (`ContainerExtension`, `ContainerProps`, `ContainerCategory`), `ContainerRegistry`, `FOLYN_CORE_OWNER`, `VaultContext`/`useVaultContext`, every built-in extension, and the `registerBuiltinExtensions()` function. Nothing outside the package imports from `src/` directly — consumers use `@folyn/container-extensions`.

## editor-languages is hosted by the app

The CodeMirror `StreamLanguage` factories in `src/editor-languages/` (mermaid, plantuml, dot) are exported as `mermaidLanguageFactory` / `plantumlLanguageFactory` / `dotLanguageFactory` but **registered by the desktop app** (`apps/desktop/src/services/registerBuiltinCodeContributions.ts`), not by `registerBuiltinExtensions()`. This package only provides them; it never imports CodeMirror into the container-render path.
