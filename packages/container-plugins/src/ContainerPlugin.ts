// ponytail: contracts moved to quill-plugin-sdk (publishable). This file
// re-exports them so existing `import from './ContainerPlugin'` and the
// package's public `@quill/container-plugins` exports keep working unchanged.
export type {
  ContainerProps,
  ContainerCategory,
  ContainerPlugin,
} from 'quill-plugin-sdk';
