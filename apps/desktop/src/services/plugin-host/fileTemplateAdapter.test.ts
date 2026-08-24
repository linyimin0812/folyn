/**
 * Tests for the file-template contribution adapter + registry.
 *
 * Covers: register populates the registry (`getFileTemplate` /
 * `getPluginFileTemplates`); dispose removes both the registry entry and the
 * palette command; the registry survives across plugin ids; no-op when no
 * templates declared. The Tauri save-dialog + writeTextFile path inside the
 * command's `run` is NOT exercised (jsdom + no Tauri) — the adapter's
 * contract is: register → registry + command present; dispose → both gone.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { PluginManifest } from '@mochi/plugin-host';
import {
  registerPluginFileTemplates,
  getFileTemplate,
  getPluginFileTemplates,
  clearFileTemplates,
} from './fileTemplateAdapter';
import { getCommands, getCommand, clearCommands } from '@/services/commandRegistry';

function manifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
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
  it('registers a template keyed by <pluginId>.<templateId>', () => {
    registerPluginFileTemplates(manifest());
    const tpl = getFileTemplate('tpl-test.meeting-notes');
    expect(tpl).toBeDefined();
    expect(tpl!.label).toBe('Meeting Notes');
    expect(tpl!.fileName).toBe('meeting-notes.md');
    expect(tpl!.template).toBe('# Meeting Notes\n\n');
  });

  it('getPluginFileTemplates lists all registered templates', () => {
    registerPluginFileTemplates(manifest());
    registerPluginFileTemplates(
      manifest({ id: 'other-plugin', contributes: { fileTemplates: [{ id: 'x', label: 'X', fileName: 'x.md', template: 'x' }] } }),
    );
    const all = getPluginFileTemplates();
    expect(all.map((t) => t.id).sort()).toEqual(['other-plugin.x', 'tpl-test.meeting-notes']);
  });
});

describe('registerPluginFileTemplates', () => {
  it('registers a "New <label>" command per template', () => {
    registerPluginFileTemplates(manifest());
    const cmd = getCommand('plugin.tpl-test.new.meeting-notes');
    expect(cmd).toBeDefined();
    expect(cmd!.title).toBe('New Meeting Notes');
    expect(cmd!.category).toBe('action');
  });

  it('returns no-op disposable when no templates declared', () => {
    expect(() =>
      registerPluginFileTemplates(manifest({ contributes: {} })).dispose(),
    ).not.toThrow();
  });

  it('dispose unregisters both the registry entry and the command', () => {
    const d = registerPluginFileTemplates(manifest());
    expect(getCommand('plugin.tpl-test.new.meeting-notes')).toBeDefined();
    expect(getFileTemplate('tpl-test.meeting-notes')).toBeDefined();
    d.dispose();
    expect(getCommand('plugin.tpl-test.new.meeting-notes')).toBeUndefined();
    expect(getFileTemplate('tpl-test.meeting-notes')).toBeUndefined();
  });
});
