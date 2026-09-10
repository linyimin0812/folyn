/**
 * Tests for the file-template contribution adapter + registry.
 *
 * Covers: register populates the registry (`getFileTemplate` /
 * `getExtensionFileTemplates`); dispose removes both the registry entry and the
 * palette command; the registry survives across extension ids; no-op when no
 * templates declared. The Tauri save-dialog + writeTextFile path inside the
 * command's `run` is NOT exercised (jsdom + no Tauri) — the adapter's
 * contract is: register → registry + command present; dispose → both gone.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ExtensionManifest } from '@folyn/extension-host';
import {
  registerExtensionFileTemplates,
  getFileTemplate,
  getExtensionFileTemplates,
  clearFileTemplates,
} from './fileTemplateAdapter';
import { getCommands, getCommand, clearCommands } from '@/services/commandRegistry';

function manifest(overrides: Partial<ExtensionManifest> = {}): ExtensionManifest {
  return {
    id: 'tpl-test',
    name: 'Template Test',
    version: '1.0.0',
    tier: 'trusted',
    main: 'index.js',
    contributes: {
      fileTemplates: [
        {
          id: 'meeting-notes',
          label: 'Meeting Notes',
          fileName: 'meeting-notes.md',
          template: '# Meeting Notes\n\n',
          icon: '📝',
        },
      ],
    },
    ...overrides,
  };
}

beforeEach(() => {
  clearCommands();
  clearFileTemplates();
});

afterEach(() => {
  clearCommands();
  clearFileTemplates();
  vi.restoreAllMocks();
});

describe('fileTemplateRegistry', () => {
  it('registers a template keyed by <extensionId>.<templateId>', () => {
    registerExtensionFileTemplates(manifest());
    const tpl = getFileTemplate('tpl-test.meeting-notes');
    expect(tpl).toBeDefined();
    expect(tpl!.label).toBe('Meeting Notes');
    expect(tpl!.fileName).toBe('meeting-notes.md');
    expect(tpl!.template).toBe('# Meeting Notes\n\n');
  });

  it('getExtensionFileTemplates lists all registered templates', () => {
    registerExtensionFileTemplates(manifest());
    registerExtensionFileTemplates(
      manifest({ id: 'other-extension', contributes: { fileTemplates: [{ id: 'x', label: 'X', fileName: 'x.md', template: 'x' }] } }),
    );
    const all = getExtensionFileTemplates();
    expect(all.map((t) => t.id).sort()).toEqual(['other-extension.x', 'tpl-test.meeting-notes']);
  });
});

describe('registerExtensionFileTemplates', () => {
  it('registers a "New <label>" command per template', () => {
    registerExtensionFileTemplates(manifest());
    const cmd = getCommand('extension.tpl-test.new.meeting-notes');
    expect(cmd).toBeDefined();
    expect(cmd!.title).toBe('New Meeting Notes');
    expect(cmd!.category).toBe('action');
  });

  it('returns no-op disposable when no templates declared', () => {
    expect(() =>
      registerExtensionFileTemplates(manifest({ contributes: {} })).dispose(),
    ).not.toThrow();
  });

  it('dispose unregisters both the registry entry and the command', () => {
    const d = registerExtensionFileTemplates(manifest());
    expect(getCommand('extension.tpl-test.new.meeting-notes')).toBeDefined();
    expect(getFileTemplate('tpl-test.meeting-notes')).toBeDefined();
    d.dispose();
    expect(getCommand('extension.tpl-test.new.meeting-notes')).toBeUndefined();
    expect(getFileTemplate('tpl-test.meeting-notes')).toBeUndefined();
  });
});
