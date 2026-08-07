import { describe, it, expect } from 'vitest';
import { validateManifest } from '@quill/plugin-sdk';
import { handler } from '../src/index';
import manifest from '../manifest.json';

describe('manifest', () => {
  it('validates against the SDK schema', () => {
    expect(() => validateManifest(manifest as any)).not.toThrow();
  });

  it('manifest id matches folder name for install_plugin cross-check', () => {
    expect(manifest.id).toBe('quill-plugin-plantuml');
  });

  it('declares the plantuml file-type with split default', () => {
    expect(manifest.tier).toBe('trusted');
    expect(manifest.contributes?.fileTypes?.[0]).toMatchObject({
      id: 'plantuml',
      extensions: ['puml', 'plantuml', 'pu'],
      handler: 'plantuml',
      defaultViewMode: 'split',
    });
  });
});

describe('handler', () => {
  it('declares edit/split/preview with useCodeMirror', () => {
    expect(handler.id).toBe('plantuml');
    expect(handler.extensions).toEqual(['puml', 'plantuml', 'pu']);
    expect(handler.supportedViewModes).toEqual(['edit', 'split', 'preview']);
    expect(handler.defaultViewMode).toBe('split');
    expect(handler.useCodeMirror).toBe(true);
    expect(handler.needsFileContent).toBe(true);
    expect(typeof handler.Preview).toBe('function');
  });
});
