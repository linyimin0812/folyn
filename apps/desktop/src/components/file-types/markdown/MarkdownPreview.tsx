import { useMemo, useRef, useEffect, useCallback, useState, createElement, Fragment } from 'react';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import remarkDirective from 'remark-directive';
import remarkDirectiveRehype from 'remark-directive-rehype';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeHighlight from 'rehype-highlight';
import rehypeReact from 'rehype-react';
import { jsx, jsxs } from 'react/jsx-runtime';
import { rehypeSourceLine } from './rehypeSourceLine';
import { ContainerRegistry, registerBuiltinPlugins, MermaidBlock, VaultContext } from '@quill/container-plugins';
import type { ContainerProps } from '@quill/container-plugins';
import { useVaultStore } from '@/store/vaultStore';
import { getHandlerByExtension, getHandlerById } from '@/components/file-types/registry';
import { isTauri } from '@/utils/platform';
import { convertFileSrc } from '@tauri-apps/api/core';
import { useAppearanceStore } from '@/store/appearanceStore';
import { useEditorStore } from '@/store/editorStore';
import { ExcalidrawPreview } from '../excalidraw/ExcalidrawPreview';
import { FileIcon } from '@/components/icons/FileIcon';
/**
 * Rehype plugin: remove <br> nodes inside <code> elements (within <pre> blocks).
 * remark-breaks converts soft line breaks to <br> in paragraphs,
 * but can also leak <br> into code blocks, causing extra blank lines in preview.
 */
function rehypeRemoveCodeBreaks() {
  function walk(node: any, insideCode: boolean) {
    if (!node || !Array.isArray(node.children)) return;
    const isCodeElement = node.type === 'element' && node.tagName === 'code';
    if (isCodeElement || insideCode) {
      node.children = node.children.filter(
        (child: any) => !(child.type === 'element' && child.tagName === 'br'),
      );
    }
    for (const child of node.children) {
      walk(child, insideCode || isCodeElement);
    }
  }
  return (tree: any) => walk(tree, false);
}

// Ensure built-in plugins are registered once
registerBuiltinPlugins();

/**
 * Build a component map from the ContainerRegistry for rehype-react.
 * remark-directive-rehype converts :::name{attrs} into <name ...attrs> hast nodes.
 * We map each registered plugin name to its React component.
 */
function buildComponentMap(): Record<string, React.ComponentType<any>> {
  const registry = ContainerRegistry.getInstance();
  const componentMap: Record<string, React.ComponentType<any>> = {};

  for (const plugin of registry.getAll()) {
    const PluginComponent = plugin.component;
    // Wrapper that adapts hast element props to ContainerProps
    componentMap[plugin.name] = function DirectiveWrapper(props: any) {
      const { children, node, ...rest } = props;
      // Merge hast node properties to ensure directive attributes like "type" are preserved
      // (some attributes like "type" may be consumed by rehype as HTML-native props)
      const nodeProperties = node?.properties ?? {};
      const mergedAttributes = { ...nodeProperties, ...rest };
      const containerProps: ContainerProps = {
        children,
        attributes: mergedAttributes,
        name: plugin.name,
      };
      return createElement(PluginComponent, containerProps);
    };
  }

  return componentMap;
}

/** Parse YAML frontmatter from markdown content */
interface FrontmatterMeta {
  name?: string;
  description?: string;
  [key: string]: string | undefined;
}

function parseFrontmatter(content: string): { meta: FrontmatterMeta | null; body: string; frontmatterLineCount: number } {
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n?/;
  const match = content.match(frontmatterRegex);
  if (!match) return { meta: null, body: content, frontmatterLineCount: 0 };

  const yamlBlock = match[1];
  const meta: FrontmatterMeta = {};
  let currentKey = '';
  let currentValue = '';

  for (const line of yamlBlock.split('\n')) {
    const keyValueMatch = line.match(/^(\w[\w-]*)\s*:\s*(.*)/);
    if (keyValueMatch) {
      if (currentKey) {
        meta[currentKey] = currentValue.trim();
      }
      currentKey = keyValueMatch[1];
      currentValue = keyValueMatch[2];
    } else if (currentKey && (line.startsWith('  ') || line.startsWith('\t'))) {
      currentValue += ' ' + line.trim();
    }
  }
  if (currentKey) {
    meta[currentKey] = currentValue.trim();
  }

  // ponytail: count newlines in the frontmatter match (incl. closing --- line) so
  // rehypeSourceLine can offset anchor source lines to match editor content lines.
  const frontmatterLineCount = (match[0].match(/\n/g) ?? []).length;

  return { meta: Object.keys(meta).length > 0 ? meta : null, body: content.slice(match[0].length), frontmatterLineCount };
}

/** Render SKILL frontmatter meta as a styled card */
function SkillMetaCard({ meta }: { meta: FrontmatterMeta }) {
  return (
    <div className="skill-meta-card">
      <div className="skill-meta-header">
        <span className="skill-meta-badge">SKILL</span>
        {meta.name && <span className="skill-meta-name">{meta.name}</span>}
      </div>
      {meta.description && (
        <p className="skill-meta-description">{meta.description}</p>
      )}
      {Object.entries(meta)
        .filter(([key]) => key !== 'name' && key !== 'description')
        .map(([key, value]) => (
          <div className="skill-meta-field" key={key}>
            <span className="skill-meta-key">{key}</span>
            <span className="skill-meta-value">{value}</span>
          </div>
        ))}
    </div>
  );
}

/** Recursively extract plain text from React children */
function extractTextContent(children: any): string {
  if (typeof children === 'string') return children;
  if (typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(extractTextContent).join('');
  if (children?.props?.children) return extractTextContent(children.props.children);
  return '';
}

/** Copy button SVG icons */
const COPY_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const CHECK_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

/** Code block wrapper component — renders line numbers + copy button via React */
function CodeBlockWrapper({ children, node, ...rest }: any) {
  const preRef = useRef<HTMLPreElement>(null);
  const copyBtnRef = useRef<HTMLButtonElement>(null);
  const [lineCount, setLineCount] = useState(0);

  useEffect(() => {
    if (!preRef.current) return;
    const codeEl = preRef.current.querySelector('code');
    const text = codeEl?.textContent ?? preRef.current.textContent ?? '';
    const lines = text.split('\n');
    while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    setLineCount(lines.length);
  }, [children]);

  const handleCopy = useCallback(() => {
    const codeEl = preRef.current?.querySelector('code');
    const text = codeEl?.textContent ?? preRef.current?.textContent ?? '';
    const btn = copyBtnRef.current;
    if (!btn) return;
    navigator.clipboard.writeText(text).then(() => {
      btn.innerHTML = CHECK_SVG;
      btn.classList.add('copied');
      setTimeout(() => {
        btn.innerHTML = COPY_SVG;
        btn.classList.remove('copied');
      }, 1500);
    });
  }, []);

  return (
    <div className="code-block-wrapper">
      <div className="code-block-inner">
        <div className="code-line-numbers" aria-hidden="true">
          {Array.from({ length: lineCount }, (_, i) => (
            <span className="code-ln" key={i}>{i + 1}</span>
          ))}
        </div>
        <pre ref={preRef} {...rest}>{children}</pre>
      </div>
      <button
        ref={copyBtnRef}
        className="code-copy-btn"
        type="button"
        onClick={handleCopy}
        dangerouslySetInnerHTML={{ __html: COPY_SVG }}
      />
    </div>
  );
}

export function MarkdownPreview({ content, filePath, vaultRoot }: import('../types').PreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [resolvedVaultRoot, setResolvedVaultRoot] = useState('');

  useEffect(() => {
    if (!vaultRoot) return;
    import('@tauri-apps/api/path').then(({ homeDir, join }) => {
      if (vaultRoot.startsWith('~')) {
        homeDir().then((h) => join(h, vaultRoot.slice(2))).then(setResolvedVaultRoot);
      } else {
        setResolvedVaultRoot(vaultRoot);
      }
    });
  }, [vaultRoot]);

  const renderFile = useCallback((path: string, content: string) => {
    const ext = path.toLowerCase().match(/\.([^.]+)$/)?.[1] || '';
    const handler = ext ? getHandlerByExtension(ext) : undefined;
    const Preview = handler?.Preview ?? getHandlerById('code')?.Preview;
    if (!Preview) return null;
    // ponytail: no recursion-depth guard — a markdown file that embeds itself
    // via :::file-preview will stack-overflow. Add a depth counter if it bites.
    return createElement(Preview, { content, filePath: path, vaultRoot: resolvedVaultRoot });
  }, [resolvedVaultRoot]);

  const openFile = useCallback((path: string) => {
    const name = path.substring(path.lastIndexOf('/') + 1) || path;
    void import('@/services/editorIoService').then(({ openFile: open }) => open(path, name));
  }, []);

  const componentMap = useMemo(() => {
    const map = buildComponentMap();
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
      const isExternal = href && (href.startsWith('http://') || href.startsWith('https://'));
      if (isExternal) {
        return createElement('a', {
          ...rest,
          href,
          onClick: (e: React.MouseEvent) => {
            e.preventDefault();
            const linkOpenMode = useAppearanceStore.getState().linkOpenMode;
            if (linkOpenMode === 'internal') {
              const linkText = typeof children === 'string' ? children : href;
              useEditorStore.getState().openWebTab(href, linkText);
            } else if (isTauri()) {
              import('@tauri-apps/plugin-shell').then(({ open }) => {
                open(href);
              });
            } else {
              window.open(href, '_blank', 'noopener,noreferrer');
            }
          },
        }, children);
      }
      return createElement('a', { href, ...rest }, children);
    };

    // Custom img component: resolve paths relative to the current document's directory
    map['img'] = function VaultImage(props: any) {
      const { src, alt, node, ...rest } = props;
      if (!src || src.startsWith('http') || src.startsWith('data:')) {
        return createElement('img', { src, alt, ...rest });
      }
      const rawPath = src.replace(/^\.\//, '');
      const imagePath = decodeURIComponent(rawPath);

      if (imagePath.endsWith('.excalidraw')) {
        const fileDir = filePath
          ? filePath.substring(0, filePath.lastIndexOf('/'))
          : '';
        const vaultPath = fileDir ? `${fileDir}/${imagePath}` : imagePath;
        return createElement(ExcalidrawPreview, { filePath: vaultPath, alt });
      }

      if (resolvedVaultRoot) {
        const fileDir = filePath
          ? filePath.substring(0, filePath.lastIndexOf('/'))
          : '';
        let absPath: string;
        if (fileDir && imagePath.startsWith(fileDir + '/')) {
          absPath = resolvedVaultRoot + '/' + imagePath;
        } else if (fileDir) {
          absPath = resolvedVaultRoot + '/' + fileDir + '/' + imagePath;
        } else {
          absPath = resolvedVaultRoot + '/' + imagePath;
        }
        const imageUrl = convertFileSrc(absPath);
        return createElement('img', { src: imageUrl, alt, loading: 'lazy', ...rest });
      }
      return createElement('img', { src, alt, loading: 'lazy', ...rest });
    };

    map['pre'] = function PreWithMermaid(props: any) {
      const { children, ...rest } = props;
      const codeChild = Array.isArray(children)
        ? children.find((c: any) => c?.props?.className?.includes('language-mermaid'))
        : children?.props?.className?.includes('language-mermaid') ? children : null;
      if (codeChild) {
        return createElement(MermaidBlock, null, codeChild.props.children);
      }
      return createElement(CodeBlockWrapper, rest, children);
    };

    return map;
  }, [filePath, vaultRoot, resolvedVaultRoot]);

  const { meta, body, frontmatterLineCount } = useMemo(() => parseFrontmatter(content), [content]);

  const reactContent = useMemo(() => {
    try {
      const result = unified()
        .use(remarkParse)
        .use(remarkGfm)
        .use(remarkBreaks)
        .use(remarkDirective)
        .use(remarkDirectiveRehype)
        .use(remarkRehype, { allowDangerousHtml: true })
        .use(rehypeRaw)
        .use(rehypeHighlight, { ignoreMissing: true } as any)
        .use(rehypeRemoveCodeBreaks)
        .use(rehypeSourceLine, { offset: frontmatterLineCount })
        .use(rehypeReact, {
          jsx,
          jsxs,
          Fragment,
          components: componentMap,
        } as any)
        .processSync(body);

      return result.result as React.ReactElement;
    } catch (error) {
      console.error('[MarkdownPreview] render error:', error);
      return createElement('p', null, '渲染错误');
    }
  }, [body, componentMap, frontmatterLineCount]);

  return (
    <VaultContext.Provider value={{
      vaultRoot: resolvedVaultRoot,
      filePath,
      readFile: (p) => useVaultStore.getState().readFile(p),
      renderFile,
      openFile,
      getFileIcon: (path) => createElement(FileIcon, { filename: path }),
    }}>
      <div className="md-preview" ref={containerRef}>
        {meta && <SkillMetaCard meta={meta} />}
        {reactContent}
      </div>
    </VaultContext.Provider>
  );
}
