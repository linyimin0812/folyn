/**
 * Tests for the process capability: a declared program runs under the
 * extension's own id; an undeclared one never reaches the host.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExtensionManifest } from '@folyn/extension-host';
import { buildExtensionProcess } from './processCapability';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import { invoke as mockInvoke } from '@tauri-apps/api/core';

function manifest(programs?: string[]): ExtensionManifest {
  return {
    id: 'demo-extension',
    name: 'Demo',
    version: '0.1.0',
    tier: 'trusted',
    main: 'index.js',
    permissions: programs ? { exec: { programs } } : {},
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('buildExtensionProcess', () => {
  it('runs a declared program and returns its output', async () => {
    const result = { stdout: 'main\n', stderr: '', exitCode: 0 };
    vi.mocked(mockInvoke).mockResolvedValueOnce(result);

    await expect(
      buildExtensionProcess(manifest(['git'])).exec('git', ['branch', '--show-current'], { cwd: '/repo' }),
    ).resolves.toEqual(result);

    expect(mockInvoke).toHaveBeenCalledWith('extension_exec', {
      extensionId: 'demo-extension',
      program: 'git',
      args: ['branch', '--show-current'],
      cwd: '/repo',
    });
  });

  it('defaults to no arguments and the host working directory', async () => {
    vi.mocked(mockInvoke).mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 });

    await buildExtensionProcess(manifest(['osascript'])).exec('osascript');

    expect(mockInvoke).toHaveBeenCalledWith('extension_exec', {
      extensionId: 'demo-extension',
      program: 'osascript',
      args: [],
      cwd: null,
    });
  });

  it('refuses a program the manifest does not declare', async () => {
    const api = buildExtensionProcess(manifest(['git']));

    await expect(api.exec('sh', ['-c', 'true'])).rejects.toThrow(/permissions\.exec\.programs/);
    // A path to a declared name is a different program.
    await expect(api.exec('/usr/bin/git')).rejects.toThrow(/permissions\.exec\.programs/);

    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('refuses everything when the manifest declares no programs', async () => {
    await expect(buildExtensionProcess(manifest()).exec('git')).rejects.toThrow(/permissions\.exec\.programs/);

    expect(mockInvoke).not.toHaveBeenCalled();
  });
});
