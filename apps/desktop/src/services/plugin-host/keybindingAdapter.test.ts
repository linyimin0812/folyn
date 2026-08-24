/**
 * Tests for the keybinding contribution adapter.
 *
 * Covers: register attaches a window `keydown` listener; a matching event
 * runs the bound command (via `runCommand`); a non-matching event does
 * nothing; dispose removes the listener. `mac` override is exercised by
 * faking a darwin platform.
 *
 * ponytail: no OS-global-shortcut dependency — this adapter uses app-scope
 * `keydown` (see the `ponytail:` note in `keybindingAdapter.ts`). Tests run
 * in jsdom which implements `document.addEventListener` + `KeyboardEvent`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { PluginManifest } from '@mochi/plugin-host';
import { registerPluginKeybindings } from './keybindingAdapter';

const runCommandMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@/services/commandRegistry', () => ({
  runCommand: (id: string) => runCommandMock(id),
}));

function manifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: 'kb-test',
    name: 'Keybinding Test',
    version: '1.0.0',
    tier: 'trusted',
    main: 'index.js',
    contributes: {
      keybindings: [
        { command: 'plugin.kb-test.ping', key: 'Control+Alt+Shift+T', mac: 'Cmd+Alt+Shift+T' },
      ],
    },
    ...overrides,
  };
}

function dispatchKey(opts: KeyboardEventInit): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', opts);
  document.dispatchEvent(ev);
  return ev;
}

beforeEach(() => {
  runCommandMock.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('registerPluginKeybindings', () => {
  it('runs the bound command when a matching keydown fires', () => {
    // Force the non-darwin branch: key = Control+Alt+Shift+T.
    const originalPlatform = navigator.platform;
    Object.defineProperty(navigator, 'platform', { value: 'Linux', configurable: true });
    const d = registerPluginKeybindings(manifest());
    dispatchKey({ key: 'T', ctrlKey: true, altKey: true, shiftKey: true });
    expect(runCommandMock).toHaveBeenCalledTimes(1);
    expect(runCommandMock).toHaveBeenCalledWith('plugin.kb-test.ping');
    d.dispose();
    Object.defineProperty(navigator, 'platform', { value: originalPlatform, configurable: true });
  });

  it('does not run the command when modifiers do not match', () => {
    const originalPlatform = navigator.platform;
    Object.defineProperty(navigator, 'platform', { value: 'Linux', configurable: true });
    const d = registerPluginKeybindings(manifest());
    // Missing alt + shift, wrong key.
    dispatchKey({ key: 't', ctrlKey: true });
    expect(runCommandMock).not.toHaveBeenCalled();
    d.dispose();
    Object.defineProperty(navigator, 'platform', { value: originalPlatform, configurable: true });
  });

  it('uses the mac accelerator on darwin', () => {
    const originalPlatform = navigator.platform;
    Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true });
    const d = registerPluginKeybindings(manifest());
    // Cmd (metaKey) + Alt + Shift + T
    dispatchKey({ key: 'T', metaKey: true, altKey: true, shiftKey: true });
    expect(runCommandMock).toHaveBeenCalledWith('plugin.kb-test.ping');
    // The Control-based accelerator must NOT fire on darwin.
    runCommandMock.mockClear();
    dispatchKey({ key: 'T', ctrlKey: true, altKey: true, shiftKey: true });
    expect(runCommandMock).not.toHaveBeenCalled();
    d.dispose();
    Object.defineProperty(navigator, 'platform', { value: originalPlatform, configurable: true });
  });

  it('dispose removes the listener (no further runs)', () => {
    const originalPlatform = navigator.platform;
    Object.defineProperty(navigator, 'platform', { value: 'Linux', configurable: true });
    const d = registerPluginKeybindings(manifest());
    d.dispose();
    dispatchKey({ key: 'T', ctrlKey: true, altKey: true, shiftKey: true });
    expect(runCommandMock).not.toHaveBeenCalled();
    Object.defineProperty(navigator, 'platform', { value: originalPlatform, configurable: true });
  });

  it('returns no-op disposable when no keybindings declared', () => {
    expect(() =>
      registerPluginKeybindings(manifest({ contributes: {} })).dispose(),
    ).not.toThrow();
  });
});
