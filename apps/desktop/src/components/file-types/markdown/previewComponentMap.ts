import { createElement } from 'react';
import { registerBuiltinExtensions } from '@folyn/container-extensions';
import type { ContainerProps } from '@folyn/container-extensions';
import { registerBuiltinCodeContributions } from '@/services/registerBuiltinCodeContributions';
import { getMarkdownCodeRenderer } from '@/services/extension-host/markdownCodeRendererAdapter';
import { getActiveContainers } from '@/services/containerRegistryService';
import { isTauri } from '@/utils/platform';
import { useAppearanceStore } from '@/store/appearanceStore';
import { useEditorStore } from '@/store/editorStore';
import { PanelErrorBoundary } from '@/components/sidebar/PanelErrorBoundary';
import { extractTextContent, CodeBlockWrapper } from './CodeBlockWrapper';
import { VaultImageInner } from './VaultImage';
import { ResizableMedia } from './ResizableMedia';

// Ensure built-in extensions are registered once
registerBuiltinExtensions();
registerBuiltinCodeContributions();

/**
 * Build a component map from the ContainerRegistry for rehype-react.
 * remark-directive-rehype converts :::name{attrs} into <name ...attrs> hast nodes.
 * We map each registered extension name to its React component.
 *
 * `offset` is the frontmatter line count, folded into each directive's
 * `data-source-line` (node.position.start.line + offset) so cursor sync
 * can locate the container block by editor line number — without it,
 * `:::name` blocks carry no `data-source-line` (directive tag names
 * aren't in rehypeSourceLine's BLOCK_TAGS), and the preview's cursor
 * sync can't align while the cursor sits inside a container directive.
 */
export function buildComponentMap(offset: number = 0): Record<string, React.ComponentType<any>> {
  const componentMap: Record<string, React.ComponentType<any>> = {};

  for (const extension of getActiveContainers()) {
    const ExtensionComponent = extension.component;
    // Wrapper that adapts hast element props to ContainerProps
    componentMap[extension.name] = function DirectiveWrapper(props: any) {
      const { children, node, ...rest } = props;
      // Merge hast node properties to ensure directive attributes like "type" are preserved
      // (some attributes like "type" may be consumed by rehype as HTML-native props)
      const nodeProperties = node?.properties ?? {};
      const mergedAttributes = { ...nodeProperties, ...rest };
      const containerProps: ContainerProps = {
        children,
        attributes: mergedAttributes,
        name: extension.name,
      };
      // Stamp the directive's source line (frontmatter-offset-adjusted) so
      // the preview's cursor sync can locate this container block —
      // querySelectorAll('[data-source-line]') then matches it like any
      // other block-level element.
      // ponytail: a container that `hidesInactiveChildren` (e.g. `tabs`,
      // `carousel`) is an OUTER container whose non-active children render
      // display:none. Stamp BOTH data-source-line (so cursor-sync can locate
      // this visible outer block) AND data-hides-inactive (so the promote-
      // to-wrapper step below pins the cursor to it by attribute, not name).
      //
      // The hidden sub-directives (tab/slide) get data-source-line too (all
      // wrappers do, above) — cursor-sync's selection loop skips them as
      // hidden / 0-height, and the promotion step decides per line whether
      // the ACTIVE child's content aligns directly or the container pins.
      const startLine = node?.position?.start?.line;
      const hides = extension.hidesInactiveChildren === true;
      const dataProps: Record<string, string> = { 'data-container': extension.name };
      if (typeof startLine === 'number') {
        dataProps['data-source-line'] = String(startLine + offset);
      }
      if (hides) dataProps['data-hides-inactive'] = 'true';
      // Tag with data-container so the export DOM walk can locate rendered
      // containers by directive name and apply extension enhancers. Transparent
      // wrapper div — container extensions use inline styles, so an extra plain
      // div does not affect their rendering.
      // ponytail: PanelErrorBoundary isolates extension render throws so a broken
      // container doesn't white-screen the whole markdown preview.
      return createElement(
        'div',
        dataProps,
        createElement(PanelErrorBoundary, { panelId: extension.name, children: createElement(ExtensionComponent, containerProps) }),
      );
    };
  }

  return componentMap;
}

export interface PreviewComponentMapParams {
  filePath: string;
  assetBase: string;
  contentRef: React.MutableRefObject<string>;
  onChangeRef: React.MutableRefObject<((content: string) => void) | undefined>;
  frontmatterLineCount: number;
}

/** Build the full rehype-react component map for the markdown preview:
 *  registry container directives + heading anchors + external links +
 *  vault-resolved images + code-block/rendered fences + raw HTML filtering. */
export function buildPreviewComponentMap({ filePath, assetBase, contentRef, onChangeRef, frontmatterLineCount }: PreviewComponentMapParams): Record<string, React.ComponentType<any>> {
  const map = buildComponentMap(frontmatterLineCount);
  // Add heading components with auto-generated id anchors for outline navigation
  const headingLevels = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const;
  for (const tag of headingLevels) {
    map[tag] = function HeadingWithId(props: any) {
      const { children, ...rest } = props;
      const textContent = extractTextContent(children);
      const headingId = textContent.toLowerCase().replace(/\s+/g, '-').replace(/[^\w\u4e00-\u9fff-]/g, '');
      return createElement(tag, { ...rest, id: headingId }, children);
    };
  }

  // Custom anchor component: handle external links based on linkOpenMode setting
  map['a'] = function ExternalLink(props: any) {
    const { href, children, node, ...rest } = props;
    // ponytail: markdown `[baidu](www.baidu.com)` (no scheme) parses as a
    // relative path → href="www.baidu.com". Without normalization it bypasses
    // the external-link branch and the Tauri webview tries to navigate to the
    // path → looks like an app restart. Treat www.-prefixed hrefs as https
    // URLs and route through the existing two-mode open logic. Bare-domain
    // (baidu.com) and protocol-relative (//host) cases left for later.
    const normalizedHref = href && typeof href === 'string' && href.startsWith('www.')
      ? `https://${href}`
      : href;
    const isExternal = normalizedHref && (normalizedHref.startsWith('http://') || normalizedHref.startsWith('https://'));
    if (isExternal) {
      return createElement('a', {
        ...rest,
        href: normalizedHref,
        onClick: (e: React.MouseEvent) => {
          e.preventDefault();
          const linkOpenMode = useAppearanceStore.getState().linkOpenMode;
          if (linkOpenMode === 'internal') {
            const linkText = typeof children === 'string' ? children : normalizedHref;
            useEditorStore.getState().openWebTab(normalizedHref, linkText);
          } else if (isTauri()) {
            import('@tauri-apps/plugin-shell').then(({ open }) => {
              open(normalizedHref);
            });
          } else {
            window.open(normalizedHref, '_blank', 'noopener,noreferrer');
          }
        },
      }, children);
    }
    return createElement('a', { href, ...rest }, children);
  };

  // Custom img component: resolve paths relative to the current document's directory.
  // Supports absolute paths (/, ~/, $HOME/, C:\), vault-relative paths, and
  // relative paths (./ ../). Absolute/home-relative paths bypass the vault
  // base join and are resolved via Tauri fs APIs.
  map['img'] = function VaultImage(props: any) {
    const { src, alt, node, ...rest } = props;
    const sourceLineRaw = rest['data-source-line'] ?? node?.properties?.['data-source-line'];
    const sourceLine = sourceLineRaw != null ? Number(sourceLineRaw) : undefined;
    return createElement(VaultImageInner, {
      src, alt, rest, sourceLine, filePath, assetBase,
      contentRef, onChangeRef,
    });
  };

  map['pre'] = function PreWithCodeRenderer(props: any) {
    const { children, node, ...rest } = props;
    // Detect fence language + source line for renderer dispatch + run/write-back.
    const langEl = Array.isArray(children)
      ? children.find((c: any) => typeof c?.props?.className === 'string' && c.props.className.includes('language-'))
      : (typeof children?.props?.className === 'string' && children.props.className.includes('language-') ? children : null);
    const lang = langEl?.props?.className?.match(/language-([\w-]+)/)?.[1];
    const rawLine = node?.properties?.['data-source-line'] ?? rest['data-source-line'];
    const sourceLine = rawLine != null ? Number(rawLine) : undefined;
    const renderer = lang ? getMarkdownCodeRenderer(lang) : undefined;
    if (renderer && langEl) {
      const source = extractTextContent(langEl.props.children);
      return createElement(
        ResizableMedia,
        { kind: 'fence', sourceLine, contentRef, onChangeRef },
        createElement(renderer.component, {
          source,
          language: lang,
          resolvedLanguage: renderer.canonical,
          filePath,
        }),
      );
    }
    return createElement(
      CodeBlockWrapper,
      { ...rest, lang, sourceLine, content: contentRef.current, onChange: onChangeRef.current },
      children,
    );
  };

  // ponytail: drop <style>/<script> from raw HTML blocks — rehypeRaw embeds
  // them as live DOM nodes, so a raw <style> with body{height:100vh;...}
  // leaks out of .md-preview and obscures the sidebar. Inline HTML
  // (<u>, <details>, …) still renders. Use a ```html code block for live
  // styled preview (CodeBlockWrapper sandboxes it in an iframe).
  // rehype-mathjax emits a scoped <style> for mjx-container layout — that
  // one is safe (scoped to MathJax selectors), so let it through.
  map['style'] = function FilteredStyle(props: any) {
    const text = extractTextContent(props.children);
    if (text.includes('mjx-')) return createElement('style', null, text);
    return null;
  };
  map['script'] = () => null;

  return map;
}
