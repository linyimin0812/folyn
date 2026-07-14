import { describe, it, expect } from 'vitest';
import { plaintextToMindElixir, mindElixirToPlaintext } from 'mind-elixir/plaintextConverter';
import { topicMarkdown } from './topicMarkdown';

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
