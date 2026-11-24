import { createElement, Fragment } from 'react';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import remarkDirective from 'remark-directive';
import remarkDirectiveRehype from 'remark-directive-rehype';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeHighlight from 'rehype-highlight';
import { all as allLowlightGrammars } from 'lowlight';
import rehypeMathjax from 'rehype-mathjax';
import rehypeReact from 'rehype-react';
import { jsx, jsxs } from 'react/jsx-runtime';
import { transformMathBrackets, unwrapInlineMath } from '@/services/markdown/renderMarkdown';
import { rehypeSourceLine } from './rehypeSourceLine';
import { rehypeBlankGap } from './rehypeBlankGap';
import { rehypeShowRawTags, remarkCollapseUnknownTagRuns } from './rehypeShowRawTags';
import { remarkSourceListNumbers } from './remarkSourceListNumbers';
import { rehypeRemoveCodeBreaks } from './rehypeRemoveCodeBreaks';
import { rehypeMarkResultBlock } from './rehypeMarkResultBlock';

/**
 * The preview's unified pipeline, extracted from MarkdownPreview so the
 * chunked renderer can run the EXACT same chain per chunk (chunked
 * rendering must not diverge from the single-document render — the
 * cursor-sync, gap compensation, image resize and code writeback all
 * consume data-source-line values that must stay identical).
 *
 * plugin order is load-bearing:
 *  remarkParse → remarkCollapseUnknownTagRuns (string-level, BEFORE any
 *  markdown plugin so raw-tag runs never parse as markdown) → remarkMath →
 *  remarkGfm → remarkSourceListNumbers → remarkBreaks → remarkDirective →
 *  remarkDirectiveRehype → remarkRehype(allowDangerousHtml) → rehypeRaw →
 *  rehypeShowRawTags → rehypeHighlight → rehypeRemoveCodeBreaks →
 *  rehypeMarkResultBlock → rehypeMathjax → rehypeSourceLine →
 *  [rehypeBlankGap] → rehypeReact.
 */
export interface MarkdownPipelineOptions {
  /** rehype-react component map (previewComponentMap). */
  componentMap: Record<string, React.ComponentType<any>>;
  /**
   * Added to every stamped data-source-line. For the full-document render
   * AND for padded chunks this is the frontmatter line count: the full doc
   * parses the body (body-relative positions), padded chunks restore the
   * same body-relative positions with leading newlines — both need the
   * frontmatter shift.
   */
  sourceLineOffset: number;
  /**
   * rehypeBlankGap config — omit to render without gaps (cursor sync off).
   * `offset` shifts line arithmetic (the leading gap uses absolute
   * `startLine − 1 + offset`; inter-block gaps are offset-invariant) and
   * `totalLines` controls the trailing EOF gap.
   */
  blankGap?: { offset: number; totalLines?: number };
}

export function buildMarkdownPipeline(opts: MarkdownPipelineOptions) {
  const extraKnownTags = Object.keys(opts.componentMap);
  const pipeline = unified()
    .use(remarkParse)
    // Stage 1 of unknown-tag display: collapse blank-line-separated
    // unknown-tag runs into literal text BEFORE any markdown plugin runs,
    // so the region's inner markdown never parses.
    .use(remarkCollapseUnknownTagRuns, { extraKnownTags })
    .use(remarkMath)
    .use(remarkGfm)
    .use(remarkSourceListNumbers)
    .use(remarkBreaks)
    .use(remarkDirective)
    .use(remarkDirectiveRehype)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeShowRawTags, { extraKnownTags })
    .use(rehypeHighlight, { languages: allLowlightGrammars, ignoreMissing: true } as any)
    .use(rehypeRemoveCodeBreaks)
    .use(rehypeMarkResultBlock)
    .use(rehypeMathjax)
    .use(rehypeSourceLine, { offset: opts.sourceLineOffset });
  if (opts.blankGap) pipeline.use(rehypeBlankGap, opts.blankGap);
  return pipeline.use(rehypeReact, {
    jsx,
    jsxs,
    Fragment,
    passNode: true,
    components: opts.componentMap,
  } as any);
}

/**
 * Run the full pipeline synchronously on a (possibly padded) markdown
 * string and return the rendered React element. Math-bracket pre-passes
 * run first (same order as the historical MarkdownPreview render).
 * Render failures degrade to an error paragraph, never a thrown render.
 */
export function renderMarkdownBody(md: string, opts: MarkdownPipelineOptions): React.ReactElement {
  try {
    const result = buildMarkdownPipeline(opts).processSync(unwrapInlineMath(transformMathBrackets(md)));
    return result.result as React.ReactElement;
  } catch (error) {
    console.error('[MarkdownPreview] render error:', error);
    return createElement('p', null, '渲染错误');
  }
}
