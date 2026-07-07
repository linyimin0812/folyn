import { describe, it, expect } from 'vitest';
import { keysToAccelerator } from './shortcutAccelerator';

describe('keysToAccelerator', () => {
  it('maps the default togglePetPanel shortcut to Cmd+Shift+Q', () => {
    expect(keysToAccelerator(['⌘', 'Shift', 'Q'])).toBe('Cmd+Shift+Q');
  });

  it('maps Ctrl to Control (not Ctrl) so Tauri parses it', () => {
    expect(keysToAccelerator(['Ctrl', 'Shift', 'P'])).toBe('Control+Shift+P');
  });

  it('maps ⌥ to Alt', () => {
    expect(keysToAccelerator(['⌘', '⌥', 'P'])).toBe('Cmd+Alt+P');
  });

  it('uppercases single-letter keys', () => {
    expect(keysToAccelerator(['⌘', 'q'])).toBe('Cmd+Q');
  });

  it('passes multi-char tokens through unchanged (e.g. F5, Space)', () => {
    expect(keysToAccelerator(['⌘', 'Shift', 'F5'])).toBe('Cmd+Shift+F5');
    expect(keysToAccelerator(['⌘', 'Space'])).toBe('Cmd+Space');
  });

  it('returns empty string for an empty keys array', () => {
    expect(keysToAccelerator([])).toBe('');
  });

  it('preserves stored order (modifiers first, key last)', () => {
    expect(keysToAccelerator(['Shift', '⌘', 'D'])).toBe('Shift+Cmd+D');
  });
});
