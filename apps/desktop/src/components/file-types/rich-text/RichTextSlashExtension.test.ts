import { describe, it, expect } from 'vitest';
import { findSlashTrigger, INITIAL_SLASH_STATE } from './RichTextSlashExtension';

describe('findSlashTrigger', () => {
  it('returns null when no "/" in text', () => {
    expect(findSlashTrigger('hello world')).toBeNull();
    expect(findSlashTrigger('')).toBeNull();
  });

  it('triggers at line start (slashIdx === 0)', () => {
    expect(findSlashTrigger('/')).toEqual({ triggerFrom: 0, filter: '' });
    expect(findSlashTrigger('/heading')).toEqual({ triggerFrom: 0, filter: 'heading' });
  });

  it('triggers after whitespace', () => {
    expect(findSlashTrigger(' /')).toEqual({ triggerFrom: 1, filter: '' });
    expect(findSlashTrigger('hello /h1')).toEqual({ triggerFrom: 6, filter: 'h1' });
    expect(findSlashTrigger('\t/')).toEqual({ triggerFrom: 1, filter: '' });
    expect(findSlashTrigger('\n/')).toEqual({ triggerFrom: 1, filter: '' });
  });

  it('does NOT trigger when preceded by non-whitespace (mid-word)', () => {
    expect(findSlashTrigger('hello/world')).toBeNull();
    expect(findSlashTrigger('a/b')).toBeNull();
  });

  it('does NOT trigger for self-closing HTML tag "/>"', () => {
    // Cursor right after ">" — afterSlash starts with ">", so no trigger.
    expect(findSlashTrigger('<br />')).toBeNull();
    // Cursor right after "/" (no ">" yet) — DOES trigger. This matches
    // the CodeMirror side's behavior: the /> guard only checks the char
    // immediately after "/", and there is none yet.
    expect(findSlashTrigger('<br /')).toEqual({ triggerFrom: 4, filter: '' });
  });

  it('cancels trigger when filter text contains whitespace', () => {
    expect(findSlashTrigger('/h1 h2')).toBeNull();
    expect(findSlashTrigger('/foo\tbar')).toBeNull();
    expect(findSlashTrigger('/a\n')).toBeNull();
  });

  it('uses only the last "/" in the line', () => {
    // Two slashes on a line — last one wins, but it must still be at line-start
    // or after whitespace. Here the second "/" is preceded by "o" → no trigger.
    expect(findSlashTrigger('/foo/bar')).toBeNull();
    // "/ /h1" — second slash is after whitespace, filter "h1"
    expect(findSlashTrigger('/ /h1')).toEqual({ triggerFrom: 2, filter: 'h1' });
  });

  it('allows non-ASCII filter text (no whitespace)', () => {
    expect(findSlashTrigger('/标题')).toEqual({ triggerFrom: 0, filter: '标题' });
  });
});

describe('INITIAL_SLASH_STATE', () => {
  it('is hidden with zeroed range', () => {
    expect(INITIAL_SLASH_STATE).toEqual({
      visible: false,
      rangeFrom: 0,
      rangeTo: 0,
      filter: '',
    });
  });
});
