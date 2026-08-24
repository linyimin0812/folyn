# Directory Structure

> How the container-plugins package is organized.

---

## Directory Layout

```
packages/container-plugins/
├── index.ts                    # Barrel exports + registerBuiltinPlugins()
├── package.json                # @folyn/container-plugins
├── tsconfig.json
└── src/
    ├── ContainerPlugin.ts      # Interface: ContainerPlugin, ContainerProps, ContainerCategory
    ├── ContainerRegistry.ts    # Singleton registry for all plugins
    └── plugins/
        ├── AiResultPlugin.tsx    # :::ai-result — AI output container
        ├── ButtonPlugin.tsx      # :::button — action buttons
        ├── CalloutPlugin.tsx     # :::callout — info/warning/tip/danger/error/note variants
        ├── CardPlugin.tsx        # :::card — card layout
        ├── CollapsiblePlugin.tsx # :::collapsible — expand/collapse sections
        ├── FilePreviewPlugin.tsx # :::file-preview — embedded file preview
        ├── GridPlugin.tsx        # :::grid — grid layout
        ├── MermaidPlugin.tsx     # :::mermaid — diagram rendering
        ├── StatusTagPlugin.tsx   # :::status-tag — status badges
        ├── StepsPlugin.tsx       # :::steps / :::step — numbered steps
        ├── TabsPlugin.tsx        # :::tabs / :::tab — tabbed content
        └── TimelinePlugin.tsx    # :::timeline — timeline layout
```

---

## Module Organization

- **One plugin per file** in `src/plugins/` — named `<Name>Plugin.tsx`
- **Each file exports a single const** — `export const <name>Plugin: ContainerPlugin`
- **Component defined locally** — as a function in the same file, not exported
- **Core types in root src** — `ContainerPlugin.ts` and `ContainerRegistry.ts`

---

## Naming Conventions

| Type | Pattern | Example |
|------|---------|---------|
| Plugin file | `<Name>Plugin.tsx` | `CalloutPlugin.tsx` |
| Plugin export | camelCase `<name>Plugin` | `calloutPlugin`, `tabsPlugin` |
| Component | PascalCase `<Name>Component` | `CalloutComponent` (local, not exported) |
| Directive name | kebab-case | `callout`, `file-preview`, `ai-result` |

---

## Adding a New Plugin

1. Create `src/plugins/<Name>Plugin.tsx`
2. Define a local component function implementing `ContainerProps`
3. Export a `ContainerPlugin` object with `name`, `icon`, `label`, `category`, `component`, `template`
4. Add to `registerBuiltinPlugins()` in `index.ts`

Reference: `packages/container-plugins/src/plugins/CalloutPlugin.tsx`
