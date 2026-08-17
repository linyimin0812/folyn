import { describe, it, expect } from 'vitest';
import {
  toKebabCase,
  appendIndexEntries,
  appendIngestLogEntry,
  appendMergeLogEntry,
} from './wikiNaming';

describe('toKebabCase', () => {
  it('folds spaces to dashes', () => {
    expect(toKebabCase('React Hooks')).toBe('react-hooks');
  });
  it('strips file extension', () => {
    expect(toKebabCase('React Hooks.md')).toBe('react-hooks');
  });
  it('folds slashes to dashes', () => {
    expect(toKebabCase('notes/tech/react')).toBe('notes-tech-react');
  });
  it('preserves CJK characters', () => {
    expect(toKebabCase('状态管理')).toBe('状态管理');
  });
  it('folds duplicates and trims edges', () => {
    expect(toKebabCase('-- React__Hooks --')).toBe('react-hooks');
  });
  it('returns empty on all-symbols input', () => {
    expect(toKebabCase('@@@')).toBe('');
  });
});

describe('appendIndexEntries', () => {
  it('appends new entries with source annotation', () => {
    const out = appendIndexEntries('# Wiki Index\n\n_No pages yet._\n', [
      { path: 'entities/react', title: 'React', source: 'notes/tech/react.md' },
    ]);
    expect(out).toContain('- [[wiki://entities/react]] React  _(notes/tech/react.md)_');
  });
  it('skips entries whose path already linked', () => {
    const existing = '# Wiki Index\n\n- [[wiki://entities/react]] React\n';
    const out = appendIndexEntries(existing, [{ path: 'entities/react', title: 'React' }]);
    expect(out).toBe(existing);
  });
  it('no-op on empty entries', () => {
    const out = appendIndexEntries('# Wiki Index\n', []);
    expect(out).toBe('# Wiki Index\n');
  });
});

describe('appendIngestLogEntry', () => {
  it('formats one-line ingest summary', () => {
    const out = appendIngestLogEntry('# Wiki Log\n', '2026-08-18', 'notes/a.md', {
      newEntities: 2,
      updatedEntities: 1,
      newConcepts: 3,
      updatedConcepts: 0,
      contradictions: 1,
    });
    expect(out.trimEnd()).toBe(
      '# Wiki Log\n- 2026-08-18 ingest notes/a.md → +2new / ~1updated entities, +3new / ~0updated concepts, 1 contradictions',
    );
  });
});

describe('appendMergeLogEntry', () => {
  it('formats merge line', () => {
    const out = appendMergeLogEntry('# Wiki Log\n', '2026-08-18', 'entities/react-2', 'entities/react');
    expect(out.trimEnd()).toBe('# Wiki Log\n- 2026-08-18 merged entities/react-2 into entities/react');
  });
});
