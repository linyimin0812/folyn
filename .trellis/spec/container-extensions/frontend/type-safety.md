# Type Safety

> Type patterns for the container-extensions package.

---

## Where the types live

The container contracts are **defined in `folyn-extension-sdk`**, not here:

- `ContainerExtension` — the extension object shape (`packages/extension-sdk/src/contracts.ts`)
- `ContainerProps` — `{ children, attributes? }` props bundle
- `ContainerCategory` — `'layout' | 'media' | 'ai' | 'data' | 'custom'`
- `FOLYN_CORE_OWNER`, `OwnedRegistry` — ownership primitives (`packages/extension-sdk/src/registry.ts`)

`src/ContainerExtension.ts` in this package re-exports them so internal imports read `from './ContainerExtension'`; the package root re-exports them for consumers. Import types with `import type` — always type-only.

## Annotating extensions

Every extension constant is annotated, which makes a missing/typo'd field a compile error:

```ts
export const calloutExtension: ContainerExtension = { ... }
```

## Registry typing

`ContainerRegistry` (`src/ContainerRegistry.ts`) is a singleton wrapping `OwnedRegistry<ContainerExtension>` keyed by `name`:

- `register(extension, ownerExtensionId = FOLYN_CORE_OWNER)` returns `{ dispose }` that removes the container only if it is still the same instance
- `ownerOf(name)` returns `FOLYN_CORE_OWNER` for built-ins, or the external extension's id — the UI uses this to distinguish built-in from third-party containers
- `removeByOwner(ownerExtensionId)` bulk-removes a reload/deactivating extension's containers

## VaultContextValue

`src/VaultContext.ts` exports the ambient-vault context type: `vaultRoot` and `filePath` are required; `readFile` returns `Promise<string>`; `renderFile`/`openFile`/`getFileIcon` are optional host capabilities. `useVaultContext()` returns `VaultContextValue | null` — null when no host supplied the context, so consumers must narrow.

## Component props

Components are typed as `(props: ContainerProps) => ReactNode`. Keep them plain function components — no generic wrappers, no `React.FC`, no `any` (`unknown` + narrowing if a custom attribute value escapes the record).
