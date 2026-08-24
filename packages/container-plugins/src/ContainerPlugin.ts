// ponytail: contracts moved to mochi-plugin-sdk (publishable). This file
// re-exports them so existing `import from './ContainerPlugin'` and the
// package's public `@mochi/container-plugins` exports keep working unchanged.
export type {
  ContainerProps,
  ContainerCategory,
  ContainerPlugin,
} from 'mochi-plugin-sdk';
