/**
 * Dev-only self-check container plugin: throws on render so the error
 * boundary in MarkdownPreview can be verified manually. Write
 * `:::plugin-error-demo` in any markdown file in dev → should show the
 * boundary fallback instead of white-screening.
 *
 * Registered only under `import.meta.env.DEV` to keep prod slash menu clean.
 */
import { ContainerRegistry } from '@mochi/container-plugins';
import type { ContainerPlugin, ContainerProps } from '@mochi/container-plugins';

function ErrorDemoComponent(_: ContainerProps): React.ReactElement {
  // ponytail: throws intentionally to verify the PanelErrorBoundary in
  // MarkdownPreview's DirectiveWrapper catches plugin render errors.
  throw new Error('plugin-error-demo: intentional throw to verify error boundary isolation');
}

const errorDemoPlugin: ContainerPlugin = {
  name: 'plugin-error-demo',
  icon: '⚠',
  label: '错误隔离自检',
  category: 'data',
  component: ErrorDemoComponent,
  template: ':::plugin-error-demo\n:::',
  description: 'dev only: render 时故意 throw,验证 error boundary 隔离',
};

export function registerErrorDemoPlugin(): void {
  if (!import.meta.env.DEV) return;
  ContainerRegistry.getInstance().register(errorDemoPlugin);
}
