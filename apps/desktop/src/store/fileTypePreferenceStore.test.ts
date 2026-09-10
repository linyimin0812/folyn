import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the storageClient (Tauri-backed) so the store is unit-testable.
const { storageClientMock } = vi.hoisted(() => ({
  storageClientMock: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/utils/storageClient', () => ({
  storageClient: storageClientMock,
}));

import { useFileTypePreferenceStore } from './fileTypePreferenceStore';

describe('fileTypePreferenceStore', () => {
  beforeEach(() => {
    useFileTypePreferenceStore.setState({ preferences: {} });
    storageClientMock.get.mockClear();
    storageClientMock.set.mockClear();
  });

  it('setPreference records and normalizes the extension', () => {
    useFileTypePreferenceStore.getState().setPreference('.DOCX', 'office-advanced');
    expect(useFileTypePreferenceStore.getState().getPreferredProvider('docx')).toBe('office-advanced');
    // Normalized: leading dot + case stripped.
    expect(useFileTypePreferenceStore.getState().preferences.docx).toBe('office-advanced');
  });

  it('getPreferredProvider returns null when none set', () => {
    expect(useFileTypePreferenceStore.getState().getPreferredProvider('pdf')).toBeNull();
  });

  it('clearPreference reverts to null', () => {
    useFileTypePreferenceStore.getState().setPreference('pdf', 'office');
    expect(useFileTypePreferenceStore.getState().getPreferredProvider('pdf')).toBe('office');
    useFileTypePreferenceStore.getState().clearPreference('pdf');
    expect(useFileTypePreferenceStore.getState().getPreferredProvider('pdf')).toBeNull();
  });

  it('persists via storageClient.set on setPreference', () => {
    useFileTypePreferenceStore.getState().setPreference('csv', 'csv-advanced');
    expect(storageClientMock.set).toHaveBeenCalledWith(
      'editor:fileTypePreference',
      expect.objectContaining({ csv: 'csv-advanced' }),
    );
  });
});
