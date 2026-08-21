/**
 * Fence preprocessor regression: ```plantuml/mermaid/graphviz fences inside
 * markmap source must be rewritten so the diagram survives markmap-lib's
 * tree builder. Two markmap-lib quirks drive the shape:
 *
 *  - markmap drops paragraphs/images between two headings (only content
 *    INSIDE a heading line survives). So the image must be appended
 *    inline to the nearest preceding heading.
 *  - Raw `<img>` HTML and `![](data:…)` URLs are stripped by markdown-it.
 *    Only `![](http-url)` makes it into a node.
 *
 * The end-to-end shape tests below run the REAL markmap-lib Transformer
 * on the preprocessed output to verify an `<img>` node actually survives.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Transformer } from 'markmap-lib';

import { preprocessMarkmapContent } from './preprocessFences';

// ponytail: CompressionStream is a Web API; jsdom doesn't ship it. Stub it
// to identity (echo input bytes) so the encoder produces deterministic
// output whose length tracks the input — the URL-cap bail test relies on
// that to push the kroki URL past 4k chars.
class MockCompressionStream {
  readable = {
    getReader: () => {
      let sent = false;
      return {
        read: async () => {
          if (sent) return { done: true, value: undefined };
          sent = true;
          return { done: false, value: this._input };
        },
      };
    },
  };
  writable = {
    getWriter: () => ({
      write: async (chunk: Uint8Array) => { this._input = chunk; },
      close: async () => {},
    }),
  };
  private _input = new Uint8Array(0);
}

const transformer = new Transformer();

beforeEach(() => {
  // @ts-expect-error — test stub
  globalThis.CompressionStream = MockCompressionStream;
});

/** Walk the markmap tree; collect every node's content + tag. */
function collectNodes(node: { content?: string; children?: unknown[]; payload?: { tag?: string } }, acc: { content: string; tag?: string }[] = []): { content: string; tag?: string }[] {
  acc.push({ content: node.content ?? '', tag: node.payload?.tag });
  for (const c of node.children ?? []) collectNodes(c as never, acc);
  return acc;
}

describe('preprocessMarkmapContent', () => {
  it('fast-paths when there are no fences', async () => {
    const out = await preprocessMarkmapContent('# Title\n## Child');
    expect(out).toBe('# Title\n## Child');
  });

  it('rewrites a ```plantuml fence to a kroki markdown image URL', async () => {
    const src = ['# H', '```plantuml', 'A -> B', '```'].join('\n');
    const out = await preprocessMarkmapContent(src);
    expect(out).toContain('![plantuml](https://kroki.io/plantuml/svg/');
    expect(out).not.toContain('```plantuml');
  });

  it('rewrites ```mermaid and ```dot fences too', async () => {
    const src = ['# H', '```mermaid', 'graph LR; A-->B', '```', '```dot', 'digraph { A -> B }', '```'].join('\n');
    const out = await preprocessMarkmapContent(src);
    expect(out).toContain('https://kroki.io/mermaid/svg/');
    expect(out).toContain('https://kroki.io/graphviz/svg/');
  });

  it('leaves unknown fence languages as source', async () => {
    const src = ['# H', '```js', 'const x = 1;', '```'].join('\n');
    const out = await preprocessMarkmapContent(src);
    expect(out).toBe(src);
  });

  it('bails on URL over 4k chars (leaves fence as-is)', async () => {
    const huge = 'digraph { ' + 'A -> '.repeat(2000) + 'Z }';
    const src = ['# H', '```dot', huge, '```'].join('\n');
    const out = await preprocessMarkmapContent(src);
    expect(out).toBe(src);
  });

  // === End-to-end shape tests: run the real markmap-lib Transformer and
  // assert an <img> node actually survives in the tree. ===

  it('end-to-end: image survives when fence sits between two headings', async () => {
    // The case that broke the previous attempts: fence between H1 and H2.
    // markmap-lib drops paragraphs/images between headings, so the
    // preprocessor must append the image INLINE to the H1 line.
    const src = ['# Topic', '', '```plantuml', 'A -> B', '```', '', '## Sub'].join('\n');
    const out = await preprocessMarkmapContent(src);
    const { root } = transformer.transform(out);
    const nodes = collectNodes(root);
    const imgNodes = nodes.filter((n) => n.content.includes('<img'));
    expect(imgNodes.length).toBe(1);
    expect(imgNodes[0].content).toContain('kroki.io/plantuml/svg/');
    expect(imgNodes[0].content).toContain('Topic');
  });

  it('end-to-end: image survives when fence is the only content (no heading)', async () => {
    const src = ['```plantuml', 'A -> B', '```'].join('\n');
    const out = await preprocessMarkmapContent(src);
    const { root } = transformer.transform(out);
    const nodes = collectNodes(root);
    const imgNodes = nodes.filter((n) => n.content.includes('<img'));
    expect(imgNodes.length).toBe(1);
    expect(imgNodes[0].content).toContain('kroki.io/plantuml/svg/');
  });

  it('end-to-end: multiple fences attach to their respective preceding headings', async () => {
    const src = [
      '# A',
      '```plantuml',
      'A1',
      '```',
      '# B',
      '```mermaid',
      'B1',
      '```',
    ].join('\n');
    const out = await preprocessMarkmapContent(src);
    const { root } = transformer.transform(out);
    const nodes = collectNodes(root);
    const plantumlNode = nodes.find((n) => n.content.includes('kroki.io/plantuml'));
    const mermaidNode = nodes.find((n) => n.content.includes('kroki.io/mermaid'));
    expect(plantumlNode).toBeDefined();
    expect(plantumlNode!.content).toContain('A');
    expect(mermaidNode).toBeDefined();
    expect(mermaidNode!.content).toContain('B');
  });
});
