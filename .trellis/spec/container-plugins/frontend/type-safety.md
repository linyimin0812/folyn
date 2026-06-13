# Type Safety

> Type patterns in the container-plugins package.

---

## Core Types

Defined in `packages/container-plugins/src/ContainerPlugin.ts`:

```ts
/** Props passed to every container component */
export interface ContainerProps {
  children?: React.ReactNode;
  attributes?: Record<string, string>;
  name?: string;
}

/** Category for organizing plugins in the slash menu */
export type ContainerCategory = 'layout' | 'media' | 'ai' | 'data' | 'custom';

/** Interface that all container plugins must implement */
export interface ContainerPlugin {
  name: string;
  icon: string;
  label: string;
  category: ContainerCategory;
  component: ComponentType<ContainerProps>;
  template: string;
  description?: string;
}
```

---

## Registry Types

`ContainerRegistry` uses `Map<string, ContainerPlugin>` — the plugin `name` is the unique key:

```ts
export class ContainerRegistry {
  private plugins = new Map<string, ContainerPlugin>();
  register(plugin: ContainerPlugin): void { this.plugins.set(plugin.name, plugin); }
  get(name: string): ContainerPlugin | undefined { return this.plugins.get(name); }
  getByCategory(category: ContainerCategory): ContainerPlugin[] { ... }
}
```

---

## Attribute Typing

Plugin attributes arrive as `Record<string, string>` — always provide defaults when reading:

```ts
const type = attributes?.type || 'info';     // fallback to default
const title = attributes?.title || variant.label;
```

No runtime validation library is used — trust the Markdown parser to produce string attributes.

---

## Forbidden Patterns

- `any` in plugin interfaces
- Extending `ContainerProps` with required fields — all props are optional
- Type assertions on `attributes` values — they are always strings from the parser
