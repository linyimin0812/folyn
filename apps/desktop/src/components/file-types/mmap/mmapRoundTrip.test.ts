import { describe, it, expect } from 'vitest';
import { plaintextToMindElixir, mindElixirToPlaintext } from 'mind-elixir/plaintextConverter';
import { topicMarkdown } from './topicMarkdown';
import { parseOutline, serializeOutline } from './outlineConverter';

describe('mind-elixir plaintext round-trip (mmap source format)', () => {
  // ponytail: ONE check for the only non-trivial behavior we own — that
  // mind-elixir's plaintext converter round-trips simple bullet trees we
  // care about. UI/canvas wiring is covered by acceptance manual testing.

  it('round-trips a simple 2-level tree through plaintext format', () => {
    const src = '- Root\n  - Child A\n  - Child B\n    - Grandchild B1';
    const data = plaintextToMindElixir(src);
    const out = mindElixirToPlaintext(data);
    // Normalize trailing newline + root wrapper if converter synthesizes one
    const norm = (s: string) => s.replace(/\n+$/g, '').trim();
    expect(norm(out)).toContain('Root');
    expect(norm(out)).toContain('Child A');
    expect(norm(out)).toContain('Child B');
    expect(norm(out)).toContain('Grandchild B1');
  });

  it('throws on empty input — caller must guard with fallback', () => {
    // Documents the contract: MindMapCanvas uses toSafeSrc() to feed
    // '- Root' when content is empty/whitespace. This test pins the
    // upstream behavior so we notice if mind-elixir starts accepting
    // empty input (which would let us drop the guard).
    expect(() => plaintextToMindElixir('')).toThrow(/no root node found/);
    expect(() => plaintextToMindElixir('   \n')).toThrow(/no root node found/);
  });

  it('topicMarkdown renders images, inline formatting, and escapes HTML', () => {
    const img = topicMarkdown('![cat](https://x.com/cat.png)');
    expect(img).toContain('<img src="https://x.com/cat.png"');
    expect(img).toContain('alt="cat"');

    const escaped = topicMarkdown('<script>alert(1)</script>');
    expect(escaped).not.toContain('<script>');
    expect(escaped).toContain('&lt;script&gt;');

    const fmt = topicMarkdown('**bold** *italic* `code`');
    expect(fmt).toContain('<strong>bold</strong>');
    expect(fmt).toContain('<em>italic</em>');
    expect(fmt).toContain('<code>code</code>');
  });
});

describe('OutlineEditor converter (strip/prepend `- ` round-trip)', () => {
  // ponytail: the converter is the only non-trivial behavior the editor
  // owns; keyboard wiring is covered by manual acceptance testing.

  it('parse+serialize round-trips a 2-level bullet tree identically', () => {
    const src = '- Root\n  - Child A\n  - Child B\n    - Grandchild';
    const out = serializeOutline(parseOutline(src));
    expect(out).toBe(src);
  });

  it('round-trips a single root', () => {
    const src = '- Root';
    const out = serializeOutline(parseOutline(src));
    expect(out).toBe(src);
  });

  it('empty/blank input yields the fallback root', () => {
    expect(parseOutline('')).toEqual([{ text: 'Root', depth: 0 }]);
    expect(parseOutline('   \n  \n')).toEqual([{ text: 'Root', depth: 0 }]);
  });

  it('parse strips the `- ` prefix and preserves depth via indent', () => {
    const rows = parseOutline('- Root\n  - Child');
    expect(rows).toEqual([
      { text: 'Root', depth: 0 },
      { text: 'Child', depth: 1 },
    ]);
  });

  it('single-root invariant: sibling-of-root lines bump to depth 1', () => {
    // Source `- A\n- B\n- C` has three depth-0 lines; the fix makes B and C
    // children of the root A, so all non-first rows are depth >= 1.
    expect(parseOutline('- A\n- B\n- C')).toEqual([
      { text: 'A', depth: 0 },
      { text: 'B', depth: 1 },
      { text: 'C', depth: 1 },
    ]);
  });

  it('single-root invariant: a later under-indented line bumps from 0 to 1', () => {
    // `- A\n  - B\n- C` — C is parsed at depth 0 but bumped to depth 1 so it
    // stays a descendant of the root A rather than a sibling.
    expect(parseOutline('- A\n  - B\n- C')).toEqual([
      { text: 'A', depth: 0 },
      { text: 'B', depth: 1 },
      { text: 'C', depth: 1 },
    ]);
  });

  it('round-trip is stable: re-parsing the serialized output yields the same rows', () => {
    const cases = [
      '- A\n- B\n- C',
      '- A\n  - B\n- C',
      '- Root\n  - Child A\n  - Child B\n    - Grandchild',
    ];
    for (const src of cases) {
      const first = parseOutline(src);
      const serialized = serializeOutline(first);
      const reparsed = parseOutline(serialized);
      expect(reparsed).toEqual(first);
    }
  });
});
