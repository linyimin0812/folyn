import { describe, it, expect } from 'vitest';
import hljs from 'highlight.js';
import './highlightLanguages';

describe('plantuml highlight.js grammar', () => {
  it('registers plantuml and aliases', () => {
    expect(hljs.getLanguage('plantuml')).toBeDefined();
    expect(hljs.getLanguage('puml')).toBeDefined();
    expect(hljs.getLanguage('pu')).toBeDefined();
  });

  it('highlights @startuml/@enduml as meta and participant as keyword', () => {
    const out = hljs.highlight(
      '@startuml\nparticipant Alice\n\' a comment\n@enduml',
      { language: 'plantuml' },
    );
    expect(out.value).toContain('hljs-meta');
    expect(out.value).toContain('hljs-keyword');
    expect(out.value).toContain('hljs-comment');
  });
});
