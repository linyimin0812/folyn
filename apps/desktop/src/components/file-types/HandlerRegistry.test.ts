import { describe, it, expect, beforeEach } from 'vitest';
import { HandlerRegistry } from './HandlerRegistry';
import type { FileTypeHandler } from './types';

function makeHandler(id: string, ext: string, overrides: Partial<FileTypeHandler> = {}): FileTypeHandler {
  return {
    id,
    extensions: [ext],
    supportedViewModes: ['edit'],
    needsFileContent: true,
    ...overrides,
  };
}

describe('HandlerRegistry / register + extension routing', () => {
  let registry: HandlerRegistry;

  beforeEach(() => {
    registry = new HandlerRegistry({ text: 'markdown' });
  });

  it('register makes a handler reachable by extension and id', () => {
    registry.register(makeHandler('custom-xyz', 'xyz'));
    expect(registry.getByExtension('xyz')?.id).toBe('custom-xyz');
    expect(registry.getById('custom-xyz')?.id).toBe('custom-xyz');
  });

  it('register replaces a prior handler with the same id (last wins)', () => {
    registry.register(makeHandler('replace-me', 'aaa', { needsFileContent: true }));
    registry.register(makeHandler('replace-me', 'aaa', { needsFileContent: false }));
    expect(registry.getById('replace-me')?.needsFileContent).toBe(false);
  });

  it('a re-registered extension points at the newest handler', () => {
    registry.register(makeHandler('first', 'shared', { needsFileContent: true }));
    registry.register(makeHandler('second', 'shared', { needsFileContent: false }));
    // Both ids exist; extension resolves to the last-registered id.
    expect(registry.getByExtension('shared')?.id).toBe('second');
    expect(registry.getById('first')).toBeDefined();
  });
});

describe('HandlerRegistry / dispose + unregister', () => {
  let registry: HandlerRegistry;

  beforeEach(() => {
    registry = new HandlerRegistry();
  });

  it('dispose removes the handler and its extension mapping', () => {
    const handle = registry.register(makeHandler('disposable', 'dsp'));
    expect(registry.getByExtension('dsp')).toBeDefined();
    handle.dispose();
    expect(registry.getByExtension('dsp')).toBeUndefined();
    expect(registry.getById('disposable')).toBeUndefined();
  });

  it('dispose is a no-op if the handler was re-registered (late dispose safe)', () => {
    const first = makeHandler('late', 'bbb', { needsFileContent: true });
    const second = makeHandler('late', 'bbb', { needsFileContent: false });
    const handle = registry.register(first);
    registry.register(second);
    handle.dispose();
    expect(registry.getById('late')?.needsFileContent).toBe(false);
    expect(registry.getByExtension('bbb')?.id).toBe('late');
  });

  it('dispose only removes the extension mapping if it still points at this id', () => {
    // First owns 'shared'; second re-registers id 'first' but also claims 'shared'.
    const first = makeHandler('first', 'shared');
    registry.register(first);
    registry.register(makeHandler('second', 'shared'));
    // Now 'shared' -> 'second'. Disposing first must not delete 'shared'.
    registry.unregister('first');
    expect(registry.getByExtension('shared')?.id).toBe('second');
  });

  it('unregister returns true/false and removes the handler', () => {
    expect(registry.unregister('absent')).toBe(false);
    registry.register(makeHandler('rm', 'rm'));
    expect(registry.unregister('rm')).toBe(true);
    expect(registry.getById('rm')).toBeUndefined();
  });
});

describe('HandlerRegistry / aliases', () => {
  it('getById resolves an alias to the target handler', () => {
    const registry = new HandlerRegistry({ text: 'markdown' });
    registry.register(makeHandler('markdown', 'md'));
    expect(registry.getById('text')?.id).toBe('markdown');
    expect(registry.getById('markdown')?.id).toBe('markdown');
  });
});

describe('HandlerRegistry / getAll + clear', () => {
  it('getAll returns every registered handler', () => {
    const registry = new HandlerRegistry();
    registry.register(makeHandler('a', 'aa'));
    registry.register(makeHandler('b', 'bb'));
    expect(registry.getAll().map((h) => h.id).sort()).toEqual(['a', 'b']);
  });

  it('clear empties the registry', () => {
    const registry = new HandlerRegistry();
    registry.register(makeHandler('a', 'aa'));
    registry.clear();
    expect(registry.getAll()).toEqual([]);
    expect(registry.getByExtension('aa')).toBeUndefined();
  });
});
