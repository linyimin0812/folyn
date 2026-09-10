// ponytail: contracts moved to folyn-extension-sdk (publishable). This file
// re-exports them so existing `import from './ContainerExtension'` and the
// package's public `@folyn/container-extensions` exports keep working unchanged.
export type {
  ContainerProps,
  ContainerCategory,
  ContainerExtension,
} from 'folyn-extension-sdk';
