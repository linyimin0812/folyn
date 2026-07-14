import { describe, it, expect } from 'vitest';
import { plaintextToMindElixir, mindElixirToPlaintext } from 'mind-elixir/plaintextConverter';

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
});
