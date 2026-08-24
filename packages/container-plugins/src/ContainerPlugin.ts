// ponytail: contracts moved to folyn-plugin-sdk (publishable). This file
// re-exports them so existing `import from './ContainerPlugin'` and the
// package's public `@folyn/container-plugins` exports keep working unchanged.
export type {
  ContainerProps,
  ContainerCategory,
  ContainerPlugin,
} from 'folyn-plugin-sdk';
