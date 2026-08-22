import { describe, it, expect } from 'vitest';
import handler from './index';

describe('rich-text file-type handler', () => {
  it('registers as .richtext with a custom WYSIWYG editor (no CodeMirror)', () => {
    expect(handler.id).toBe('rich-text');
    expect(handler.extensions).toEqual(['richtext']);
    expect(handler.useCodeMirror).toBe(false);
    expect(handler.supportedViewModes).toEqual(['edit']);
    expect(handler.defaultViewMode).toBe('edit');
    expect(handler.needsFileContent).toBe(true);
    expect(handler.Editor).toBeDefined();
  });
});
