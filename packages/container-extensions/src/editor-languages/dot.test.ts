import { describe, it, expect } from 'vitest';
import { dotStream } from './dot';

/** Collect [nodeName, tokenText] pairs for every leaf in the parsed tree. */
function tokenize(code: string): Array<[string, string]> {
  const tree = dotStream.parser.parse(code);
  const out: Array<[string, string]> = [];
  tree.iterate({
    enter(node) {
      out.push([node.name, code.slice(node.from, node.to)]);
    },
  });
  return out.filter(([name]) => name !== 'Document');
}

function tagsFor(toks: Array<[string, string]>, text: string): string[] {
  return toks.filter(([, t]) => t === text).map(([name]) => name);
}

describe('dot stream language', () => {
  it('highlights graph keywords as meta', () => {
    const toks = tokenize('digraph G { subgraph cluster_0 { strict graph H {} } }');
    expect(tagsFor(toks, 'digraph')).toContain('meta');
    expect(tagsFor(toks, 'graph')).toContain('meta');
    expect(tagsFor(toks, 'subgraph')).toContain('meta');
    expect(tagsFor(toks, 'strict')).toContain('meta');
  });

  it('highlights node/edge attributes and values', () => {
    const src = `digraph G {
  rankdir=LR;
  a [shape=box, style="rounded,filled", fillcolor="#ff0000"];
  b [label="node B"];
  a -> b [arrowhead=vee, penwidth=2, color=red];
}`;
    const toks = tokenize(src);
    expect(tagsFor(toks, 'rankdir')).toContain('keyword');
    expect(tagsFor(toks, 'LR')).toContain('atom');
    expect(tagsFor(toks, 'shape')).toContain('keyword');
    expect(tagsFor(toks, 'box')).toContain('atom');
    expect(tagsFor(toks, 'style')).toContain('keyword');
    expect(tagsFor(toks, '"rounded,filled"')).toContain('string');
    expect(tagsFor(toks, 'fillcolor')).toContain('keyword');
    expect(tagsFor(toks, '"#ff0000"')).toContain('string');
    expect(tagsFor(toks, 'label')).toContain('keyword');
    expect(tagsFor(toks, '->')).toContain('operator');
    expect(tagsFor(toks, 'arrowhead')).toContain('keyword');
    expect(tagsFor(toks, 'vee')).toContain('atom');
    expect(tagsFor(toks, 'penwidth')).toContain('keyword');
    expect(tagsFor(toks, '2')).toContain('number');
    expect(tagsFor(toks, 'color')).toContain('keyword');
  });

  it('highlights comments', () => {
    // StreamLanguage parses line-by-line: the multi-line block comment
    // splits into per-line comment tokens, all tagged 'comment'.
    const toks = tokenize('// line comment\n/* block\ncomment */');
    expect(tagsFor(toks, '// line comment')).toContain('comment');
    expect(tagsFor(toks, '/*')).toContain('comment');
    expect(toks.every(([name]) => name === 'comment')).toBe(true);
  });

  it('keeps node identifiers as variable names', () => {
    const toks = tokenize('digraph G { a [label="A"]; cluster_0; }');
    expect(tagsFor(toks, 'G')).toContain('variableName');
    expect(tagsFor(toks, 'a')).toContain('variableName');
    expect(tagsFor(toks, 'cluster_0')).toContain('variableName');
  });
});
