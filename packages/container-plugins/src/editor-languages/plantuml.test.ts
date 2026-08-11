import { describe, it, expect } from 'vitest';
import { plantumlStream } from './plantuml';

/** Collect [nodeName, tokenText] pairs for every leaf in the parsed tree. */
function tokenize(code: string): Array<[string, string]> {
  const tree = plantumlStream.parser.parse(code);
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

describe('plantuml stream language', () => {
  it('highlights @start/@end diagram directives as meta', () => {
    const toks = tokenize('@startuml\n@enduml\n@startmindmap\n@endmindmap');
    expect(tagsFor(toks, '@startuml')).toContain('meta');
    expect(tagsFor(toks, '@enduml')).toContain('meta');
    expect(tagsFor(toks, '@startmindmap')).toContain('meta');
    expect(tagsFor(toks, '@endmindmap')).toContain('meta');
  });

  it('highlights common element/flow keywords', () => {
    const src = `actor Alice
participant Bob
usecase Login
skinparam defaultFontSize 16
note right of Alice
  hi
end note
alt ok
else fail
end
while busy
  work
endwhile`;
    const toks = tokenize(src);
    for (const kw of ['actor', 'participant', 'usecase', 'skinparam', 'note', 'end', 'alt', 'else', 'while', 'endwhile']) {
      expect(tagsFor(toks, kw)).toContain('keyword');
    }
  });

  it('matches whole-phrase layout keywords as a single meta token', () => {
    const toks = tokenize('left to right direction\ntop to bottom direction');
    expect(toks).toContainEqual(['meta', 'left to right direction']);
    expect(toks).toContainEqual(['meta', 'top to bottom direction']);
  });

  it('matches keywords case-insensitively', () => {
    const toks = tokenize('ACTOR Alice\nSKINPARAM x 1\n@STARTUML');
    expect(tagsFor(toks, 'ACTOR')).toContain('keyword');
    expect(tagsFor(toks, 'SKINPARAM')).toContain('keyword');
    expect(tagsFor(toks, '@STARTUML')).toContain('meta');
  });

  it('highlights arrows, strings, comments and function calls', () => {
    const src = `Alice -> Bob : "hello"
Bob --> Alice : "reply"
' line comment
%date()`;
    const toks = tokenize(src);
    expect(tagsFor(toks, '->')).toContain('operator');
    expect(tagsFor(toks, '-->')).toContain('operator');
    expect(tagsFor(toks, '"hello"')).toContain('string');
    expect(tagsFor(toks, "' line comment")).toContain('comment');
    expect(tagsFor(toks, '%date()')).toContain('variableName.definition');
  });
});
