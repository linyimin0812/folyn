import { describe, it, expect, beforeEach, vi } from 'vitest';

// Tests the binary-source branch of `exportActiveSource`. The text-source
// branch (markdown/code/svg/etc.) reuses the same `tab.content` → Blob path
// already covered by the existing exportMarkdown tests in useExport.test.ts.
// The new logic: when the active tab's file-type handler has
// `needsFileContent: false` (office / image / font / etc.), `tab.content` is
// empty by design (openFile skips the read), so we must read raw bytes from
// disk via `vaultStore.manager.readFileBytes` and build the Blob from bytes.

vi.mock('@/store/editorStore', () => ({
  useEditorStore: {
    getState: () => ({
      tabs: [
        {
          id: 't1',
          name: 'report.pdf',
          path: 'docs/report.pdf',
          content: '',
          isDirty: false,
          fileType: 'office',
        },
      ],
      activeTabId: 't1',
    }),
  },
}));

// vi.hoisted: vi.mock factories are hoisted above the const declarations, so
// referencing plain `const` mocks inside them throws "Cannot access X before
// initialization" when the mocked module is first imported.
const { readFileBytesMock, downloadBlobMock } = vi.hoisted(() => ({
  readFileBytesMock: vi.fn(async () => new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])),
  downloadBlobMock: vi.fn(async (_blob: Blob, _filename: string, _extensions?: string[]) => {}),
}));

vi.mock('@/store/vaultStore', () => ({
  useVaultStore: {
    getState: () => ({
      currentVault: { basePath: '/vault' },
      manager: { readFileBytes: readFileBytesMock },
    }),
  },
}));

vi.mock('@/components/file-types/registry', () => ({
  getHandlerById: () => ({ id: 'office', needsFileContent: false }),
}));

vi.mock('@/services/export/shared', () => ({
  downloadBlob: downloadBlobMock,
  inlineImages: vi.fn(),
  escapeHtml: vi.fn(),
  renderFilePreviewToSvg: vi.fn(),
  svgToPngBlob: vi.fn(),
}));

vi.mock('@/services/exportService', () => ({
  renderMarkdownToHtmlViaDom: vi.fn(),
  HTML_STYLES: '',
  LIGHT_THEME_VARS: '',
  DARK_THEME_VARS: '',
  hasContainerSyntax: () => false,
}));

import { exportActiveSource } from './useExport';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('exportActiveSource — binary branch', () => {
  it('reads raw bytes for needsFileContent=false handlers and downloads a non-empty blob', async () => {
    await exportActiveSource();

    expect(readFileBytesMock).toHaveBeenCalledWith('docs/report.pdf');
    expect(downloadBlobMock).toHaveBeenCalledTimes(1);

    const [blob, filename, extensions] = downloadBlobMock.mock.calls[0];
    expect(filename).toBe('report.pdf');
    expect(extensions).toEqual(['pdf']);
    expect(blob.type).toBe('application/octet-stream');

    // ponytail: the regression this guards against — before the fix, the
    // blob was built from `tab.content` ('') and downloaded as 0 bytes.
    // jsdom Blob lacks arrayBuffer()/text(), but .size reflects the parts,
    // so the byte-length assertion still proves the blob is non-empty and
    // built from the raw bytes (5 bytes) rather than the empty string.
    expect(blob.size).toBe(5);
  });
});
