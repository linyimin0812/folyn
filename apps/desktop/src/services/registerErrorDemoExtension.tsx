/**
 * Dev-only self-check container extension: throws on render so the error
 * boundary in MarkdownPreview can be verified manually. Write
 * `:::extension-error-demo` in any markdown file in dev → should show the
 * boundary fallback instead of white-screening.
 *
 * Registered only under `import.meta.env.DEV` to keep prod slash menu clean.
 */
import { ContainerRegistry } from '@folyn/container-extensions';
import type { ContainerExtension, ContainerProps } from '@folyn/container-extensions';

function ErrorDemoComponent(_: ContainerProps): React.ReactElement {
  // ponytail: throws intentionally to verify the PanelErrorBoundary in
  // MarkdownPreview's DirectiveWrapper catches extension render errors.
  throw new Error('extension-error-demo: intentional throw to verify error boundary isolation');
}

const errorDemoExtension: ContainerExtension = {
  name: 'extension-error-demo',
  icon: '⚠',
  label: '错误隔离自检',
  category: 'data',
  component: ErrorDemoComponent,
  template: ':::extension-error-demo\n:::',
  description: 'dev only: render 时故意 throw,验证 error boundary 隔离',
};

export function registerErrorDemoExtension(): void {
  if (!import.meta.env.DEV) return;
  ContainerRegistry.getInstance().register(errorDemoExtension);
}
