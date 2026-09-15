import { createElement, Fragment, useMemo, type ReactNode } from 'react';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkDirective from 'remark-directive';
import remarkDirectiveRehype from 'remark-directive-rehype';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeReact from 'rehype-react';
import { jsx, jsxs } from 'react/jsx-runtime';
import { ContainerRegistry, VaultContext, type ContainerProps } from '@folyn/container-extensions';
import { PanelErrorBoundary } from '@/components/sidebar/PanelErrorBoundary';
import { useVaultStore } from '@/store/vaultStore';
import { readFileByRoute } from '@/services/editorIoService';

/**
 * Render a snippet of markdown — typically a container directive's own
 * `template` — into live React, so the Containers settings page can show each
 * directive's real "样式" (how it looks in a doc).
 *
 * This is a deliberately minimal slice of the MarkdownPreview pipeline
 * (no math / gfm / source-lines / scroll-sync): remark-parse +
 * remark-directive turns `:::name{attrs}` into hast elements, rehype-react
 * maps each registered container name to its component via
 * {@link ContainerRegistry}, and {@link PanelErrorBoundary} isolates a
 * throwing container so one broken preview never whites the page.
 *
 * Wrapped in a {@link VaultContext} that carries the current vault root +
 * `readFileByRoute`, so a `:::file-preview` sample resolves like it does in
 * the editor (and degrades gracefully when the sample file is absent).
 *
 * Renders under the `container-preview-frame` variant of `.md-preview`
 * (see index.css): full width (no 800px cap) with first/last vertical
 * margins flattened, so top + bottom spacing is symmetric in the frame.
 */
export function ContainerPreview({ template }: { template: string }) {
  // The current vault root drives VaultContext (file-preview resolves against
  // it). Reading it through the store keeps the preview live across vault
  // switches without threading a prop.
  const vaultRoot = useVaultStore((s) => s.currentVault?.basePath ?? '');

  // Parse the template into React. The component map is rebuilt inside
  // the memo so it reads the live registry — a freshly-activated extension's
  // containers resolve on the next parse. Each card's template is unique, so
  // caching by template avoids re-parsing the same directive repeatedly.
  const reactContent = useMemo(() => {
    const registry = ContainerRegistry.getInstance();
    const componentMap: Record<string, React.ComponentType<any>> = {};
    for (const extension of registry.getAll()) {
      const ExtensionComponent = extension.component;
      componentMap[extension.name] = function DirectiveWrapper(props: any) {
        const { children, node, ...rest } = props;
        // Merge hast node properties so directive attributes (type, title, …)
        // survive the same way they do in MarkdownPreview's buildComponentMap.
        const nodeProperties = node?.properties ?? {};
        const containerProps: ContainerProps = {
          children,
          attributes: { ...nodeProperties, ...rest },
          name: extension.name,
        };
        return createElement(
          'div',
          { 'data-container': extension.name },
          createElement(PanelErrorBoundary, {
            panelId: extension.name,
            surface: `container-preview:${extension.name}`,
            children: createElement(ExtensionComponent, containerProps),
          }),
        );
      };
    }

    try {
      const result = unified()
        .use(remarkParse)
        .use(remarkDirective)
        .use(remarkDirectiveRehype)
        .use(remarkRehype, { allowDangerousHtml: true })
        .use(rehypeRaw)
        .use(rehypeReact, {
          jsx,
          jsxs,
          Fragment,
          passNode: true,
          components: componentMap,
        } as any)
        .processSync(template);
      return result.result as ReactNode;
    } catch (error) {
      console.error('[ContainerPreview] render error:', error);
      return createElement('p', null, '渲染错误');
    }
  }, [template]);

  // Mirror MarkdownPreview's VaultContext shape (minimal): vault root +
  // readFile routed the same way as the editor. filePath/openFile are left
  // empty here — previews aren't tied to a document.
  const vaultContextValue = useMemo(
    () => ({
      vaultRoot,
      filePath: '',
      readFile: (p: string) => readFileByRoute(p),
    }),
    [vaultRoot],
  );

  return (
    <VaultContext.Provider value={vaultContextValue}>
      {/* w-full + container-preview-frame: full width, with first/last
          vertical margins flattened so the preview's top + bottom spacing
          is symmetric inside the frame's padding. No pointerEvents lock —
          the modal preview is its own surface, so interactive containers
          (tabs/buttons) work: tab buttons switch, links hover, etc. The
          modal panel stops propagation so clicks here never close it. */}
      <div className="md-preview w-full container-preview-frame">
        {reactContent}
      </div>
    </VaultContext.Provider>
  );
}
