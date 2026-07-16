import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useNavStore } from './navStore';

beforeEach(() => {
  useNavStore.setState({ currentPage: 'editor', settingsTab: 'appearance' });
});

describe('useNavStore', () => {
  it('defaults to editor/appearance', () => {
    expect(useNavStore.getState().currentPage).toBe('editor');
    expect(useNavStore.getState().settingsTab).toBe('appearance');
  });

  it('setCurrentPage updates state', () => {
    useNavStore.getState().setCurrentPage('settings');
    expect(useNavStore.getState().currentPage).toBe('settings');
  });

  it('setSettingsTab updates state', () => {
    useNavStore.getState().setSettingsTab('editor');
    expect(useNavStore.getState().settingsTab).toBe('editor');
  });
});
