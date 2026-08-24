import { describe, it, expect } from 'vitest';
import { buildSlashInsertString, filterSlashEntries, splitSlashTokens } from './ChatInput';
import type { CommandEntry, SkillEntry } from '@mochi/cli-adapter';

describe('buildSlashInsertString (per-CLI /name rules)', () => {
  it('Claude skill → /<name> (bare slash, no skill: prefix)', () => {
    expect(buildSlashInsertString({ kind: 'skill', name: 'code-reader' }, 'claude')).toBe('/code-reader');
  });

  it('Pi skill → /skill:<name> (mandatory skill: prefix)', () => {
    expect(buildSlashInsertString({ kind: 'skill', name: 'ask-matt' }, 'pi')).toBe('/skill:ask-matt');
  });

  it('command (both CLIs) → /<name> (bare slash, like templates)', () => {
    expect(buildSlashInsertString({ kind: 'command', name: 'review' }, 'claude')).toBe('/review');
    expect(buildSlashInsertString({ kind: 'command', name: 'review' }, 'pi')).toBe('/review');
  });

  it('Claude grouped command → /group:name preserved verbatim', () => {
    expect(buildSlashInsertString({ kind: 'command', name: 'trellis:continue' }, 'claude')).toBe('/trellis:continue');
  });

  it('with args → /name <args> (trimmed)', () => {
    expect(buildSlashInsertString({ kind: 'command', name: 'review' }, 'claude', '  https://x  ')).toBe('/review https://x');
    expect(buildSlashInsertString({ kind: 'skill', name: 'ask-matt' }, 'pi', 'what now')).toBe('/skill:ask-matt what now');
  });

  it('empty/whitespace args → bare trigger', () => {
    expect(buildSlashInsertString({ kind: 'command', name: 'review' }, 'claude', '   ')).toBe('/review');
    expect(buildSlashInsertString({ kind: 'command', name: 'review' }, 'claude', undefined)).toBe('/review');
  });

  it('Pi command with skill-like name still uses bare slash (only skills get skill: prefix)', () => {
    expect(buildSlashInsertString({ kind: 'command', name: 'skill-thing' }, 'pi')).toBe('/skill-thing');
  });
});

describe('filterSlashEntries (/ prefix filter)', () => {
  const skills: SkillEntry[] = [
    { name: 'code-reader', description: 'reads code', source: 'user', dir: '/x' },
    { name: 'brainstorm', description: 'ideation tool', source: 'project', dir: '/y' },
  ];
  const commands: CommandEntry[] = [
    { name: 'review', description: 'review staged', source: 'user', file: '/z' },
    { name: 'trellis:continue', description: 'continue task', source: 'project', file: '/w', argumentHint: '<id>' },
  ];

  it('empty query returns all (capped at 20)', () => {
    const out = filterSlashEntries(skills, commands, '');
    expect(out.skills).toHaveLength(2);
    expect(out.commands).toHaveLength(2);
  });

  it('matches on name (prefix-free substring)', () => {
    const out = filterSlashEntries(skills, commands, 'code');
    expect(out.skills.map((s) => s.name)).toEqual(['code-reader']);
    expect(out.commands).toEqual([]);
  });

  it('matches on description', () => {
    const out = filterSlashEntries(skills, commands, 'ideation');
    expect(out.skills.map((s) => s.name)).toEqual(['brainstorm']);
  });

  it('matches commands by group:name', () => {
    const out = filterSlashEntries(skills, commands, 'trellis');
    expect(out.commands.map((c) => c.name)).toEqual(['trellis:continue']);
  });

  it('is case-insensitive', () => {
    const out = filterSlashEntries(skills, commands, 'REVIEW');
    expect(out.commands.map((c) => c.name)).toEqual(['review']);
  });

  it('caps each section at 20', () => {
    const many: SkillEntry[] = Array.from({ length: 25 }, (_, i) => ({
      name: `s${i}`, description: 'd', source: 'user' as const, dir: `/s${i}`,
    }));
    expect(filterSlashEntries(many, [], '').skills).toHaveLength(20);
  });
});

describe('splitSlashTokens (/name highlight segmentation)', () => {
  const join = (segs: { text: string; isToken: boolean }[]) => segs.map((s) => s.text).join('');

  it('no token → one plain segment equal to input', () => {
    const segs = splitSlashTokens('hello world');
    expect(segs).toHaveLength(1);
    expect(segs[0]).toEqual({ text: 'hello world', isToken: false });
    expect(join(segs)).toBe('hello world');
  });

  it('empty input → one empty plain segment', () => {
    const segs = splitSlashTokens('');
    expect(segs).toHaveLength(1);
    expect(segs[0]).toEqual({ text: '', isToken: false });
  });

  it('/skill-name alone → one token segment', () => {
    const segs = splitSlashTokens('/skill-name');
    expect(segs).toHaveLength(1);
    expect(segs[0]).toEqual({ text: '/skill-name', isToken: true });
    expect(join(segs)).toBe('/skill-name');
  });

  it('hello /skill:name world → three segments joining back to original', () => {
    const segs = splitSlashTokens('hello /skill:name world');
    expect(segs).toEqual([
      { text: 'hello ', isToken: false },
      { text: '/skill:name', isToken: true },
      { text: ' world', isToken: false },
    ]);
    expect(join(segs)).toBe('hello /skill:name world');
  });

  it('/trellis:continue arg → token + text', () => {
    const segs = splitSlashTokens('/trellis:continue arg');
    expect(segs).toEqual([
      { text: '/trellis:continue', isToken: true },
      { text: ' arg', isToken: false },
    ]);
    expect(join(segs)).toBe('/trellis:continue arg');
  });

  it('a mid-word / is NOT a token (no whitespace before)', () => {
    const segs = splitSlashTokens('a/b/c');
    expect(segs).toHaveLength(1);
    expect(segs[0]).toEqual({ text: 'a/b/c', isToken: false });
    expect(join(segs)).toBe('a/b/c');
  });

  it('multiple tokens across lines (newline counts as whitespace)', () => {
    const segs = splitSlashTokens('/foo bar /baz');
    expect(segs.map((s) => s.isToken)).toEqual([true, false, true]);
    expect(join(segs)).toBe('/foo bar /baz');
  });

  it('token after newline is recognized', () => {
    const segs = splitSlashTokens('text\n/skill:x');
    expect(segs.some((s) => s.isToken && s.text === '/skill:x')).toBe(true);
    expect(join(segs)).toBe('text\n/skill:x');
  });
});
