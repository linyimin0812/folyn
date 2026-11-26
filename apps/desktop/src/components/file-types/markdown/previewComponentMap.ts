import { createElement } from 'react';
import { snapshotComponentState } from './headingNav';
import { registerBuiltinExtensions } from '@folyn/container-extensions';
import type { ContainerProps } from '@folyn/container-extensions';
import { registerBuiltinCodeContributions } from '@/services/registerBuiltinCodeContributions';
import { getMarkdownCodeRenderer } from '@/services/extension-host/markdownCodeRendererAdapter';
import { getActiveContainers } from '@/services/containerRegistryService';
import { isTauri } from '@/utils/platform';
import { useAppearanceStore } from '@/store/appearanceStore';
import { useEditorStore } from '@/store/editorStore';
import { openFile } from '@/services/editorIoService';
import { useDocLinkHistory } from '@/store/docLinkHistory';
import { PanelErrorBoundary } from '@/components/sidebar/PanelErrorBoundary';
import { extractTextContent, CodeBlockWrapper } from './CodeBlockWrapper';
import { VaultImageInner } from './VaultImage';
import { ResizableMedia } from './ResizableMedia';
import { TableFocusWrap } from './TableFocusWrap';
import { classifyLinkHref } from './linkTarget';
import { navigateToHeadingId } from './headingNav';
import { useLinkPreviewStore, type AnchorRect } from './linkPreviewStore';
import { isPreviewableTarget } from './linkPreviewModel';

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

  // Custom anchor component: only http(s)/www. hrefs are web pages (opened per
  // linkOpenMode); any other scheme-less href is a document link resolved
  // against this file and opened in the editor.
  map['a'] = function MarkdownLink(props: any) {
    const { href, children, node, ...rest } = props;
    if (typeof href !== 'string' || !href) return createElement('a', { href, ...rest }, children);
    const target = classifyLinkHref(href, filePath);
    if (target.kind === 'system') {
      return createElement('a', { href, ...rest }, children);
    }
    if (target.kind === 'anchor') {
      // In-document anchor (`#id`): the app shell doesn't scroll — .prev-body
      // does, so the browser's default hash navigation is a no-op. Drive the
      // jump ourselves: record the current reading position on the tab's
      // navigation trail (Back returns to it), then reveal hidden containers
      // (tabs/collapsibles) around the target heading and scroll to it.
      const fragment = href.slice(1);
      return createElement('a', {
        ...rest,
        href,
        onClick: (e: React.MouseEvent) => {
          e.preventDefault();
          const body = (e.currentTarget as Element).closest('.prev-body');
          if (!body) return;
          useDocLinkHistory.getState().pushPosition(
            body.scrollTop,
            snapshotComponentState(body),
          );
          navigateToHeadingId(body, fragment);
        },
      }, children);
    }
    if (target.kind === 'file') {
      // Doc link — keep the `#fragment` (resolveLinkPath strips it for the
      // path) so the navigation restore can scroll onto the target heading
      // once the document renders; capture the leaving preview's live
      // scrollTop so Back returns to the exact reading spot.
      const fragment = href.match(/#([^?#]*)$/)?.[1];
      // Hover preview (spec 5.2): rest on the link 500ms → glimpse the
      // target doc (name/path/section/excerpt) without navigating. Only
      // markdown text targets; images etc. would show an empty popover.
      const hoverPreview = isPreviewableTarget(target.path);
      const onEnter = hoverPreview
        ? (e: React.MouseEvent) => {
            const r = (e.currentTarget as Element).getBoundingClientRect();
            useLinkPreviewStore.getState().beginHover(
              { path: target.path, fragment: fragment || undefined },
              { left: r.left, right: r.right, top: r.top, bottom: r.bottom } satisfies AnchorRect,
            );
          }
        : undefined;
      const onLeave = hoverPreview
        ? () => useLinkPreviewStore.getState().endHover()
        : undefined;
      const onClick = (e: React.MouseEvent) => {
        e.preventDefault();
        // Spec 6.2 — background open (⌘/Ctrl+click): open the target as a
        // NEW tab to the right of the current one, without navigating away
        // and without stealing focus. Same-doc duplicates get their own
        // reading context (forceNew).
        if (e.metaKey || e.ctrlKey) {
          const name = target.path.substring(target.path.lastIndexOf('/') + 1) || target.path;
          const activeTabId = useEditorStore.getState().activeTabId;
          void openFile(target.path, name, { forceNew: true, background: true, insertAfterTabId: activeTabId ?? undefined });
          useLinkPreviewStore.getState().close();
          return;
        }
        // A click is a committed navigation: drop any preview state.
        useLinkPreviewStore.getState().close();
        const name = target.path.substring(target.path.lastIndexOf('/') + 1) || target.path;
        const body = (e.currentTarget as Element).closest('.prev-body');
        useDocLinkHistory.getState().follow(
          { path: target.path, name, anchorId: fragment || undefined },
          body?.scrollTop,
          body ? snapshotComponentState(body) : undefined,
        );
      };
      // Middle-click opens in background too (browser muscle memory).
      const onAuxClick = (e: React.MouseEvent) => {
        if (e.button !== 1) return;
        e.preventDefault();
        useLinkPreviewStore.getState().close();
        const name = target.path.substring(target.path.lastIndexOf('/') + 1) || target.path;
        const activeTabId = useEditorStore.getState().activeTabId;
        void openFile(target.path, name, { forceNew: true, background: true, insertAfterTabId: activeTabId ?? undefined });
      };
      return createElement('a', {
        ...rest,
        href,
        onMouseEnter: onEnter,
        onMouseLeave: onLeave,
        onClick,
        onAuxClick,
      }, children);
    }
    const url = target.url;
    return createElement('a', {
      ...rest,
      href: url,
      onClick: (e: React.MouseEvent) => {
        e.preventDefault();
        const linkOpenMode = useAppearanceStore.getState().linkOpenMode;
        if (linkOpenMode === 'internal') {
          const linkText = typeof children === 'string' ? children : url;
          useEditorStore.getState().openWebTab(url, linkText);
        } else if (isTauri()) {
          import('@tauri-apps/plugin-shell').then(({ open }) => {
            open(url);
          });
        } else {
          window.open(url, '_blank', 'noopener,noreferrer');
        }
      },
    }, children);
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

  // ponytail: horizontal-scroll table wrapper. Tables auto-size columns by
  // content (thead keep-all keeps field names whole; cells wrap long text);
  // a genuinely wide table scrolls INSIDE this frame instead of stretching
  // the reading column or scrolling the page sideways. The wrapper and the
  // inner table BOTH carry data-source-line (same source line): cursor-sync
  // target selection picks the later-in-DOM element on line ties → the TABLE
  // itself wins, keeping the row-anchoring path (thead row 0 / tbody row K)
  // intact, while the wrapper stays a gap-compensation block root (a direct
  // rootEl child with data-source-line, like .code-block-wrapper).
  // TableFocusWrap keeps that exact DOM contract (root div with
  // data-source-line → .md-table-wrap → table) and adds the 专注查看 entry.
  map['table'] = function TableWrap(props: any) {
    const { children, node, ...rest } = props;
    const sourceLineRaw = rest['data-source-line'] ?? node?.properties?.['data-source-line'];
    const sourceLine = sourceLineRaw != null ? Number(sourceLineRaw) : undefined;
    return createElement(TableFocusWrap, { sourceLine, tableProps: rest }, children);
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
