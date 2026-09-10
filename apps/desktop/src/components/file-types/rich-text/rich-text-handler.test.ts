import { describe, it, expect } from 'vitest';
import handler from './index';

describe('rich-text file-type handler', () => {
  it('registers as .richtext with a custom WYSIWYG editor (no shell-editor)', () => {
    expect(handler.id).toBe('rich-text');
    expect(handler.extensions).toEqual(['richtext']);
    expect(handler.needsFileContent).toBe(true);
    expect(handler.defaultMode).toBe('edit');
    expect(handler.modes).toHaveLength(1);
    expect(handler.modes[0].id).toBe('edit');
    expect(handler.modes[0].kind).toBe('component');
    expect(handler.modes[0].component).toBeDefined();
  });
});
