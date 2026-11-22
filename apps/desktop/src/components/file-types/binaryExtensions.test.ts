import { describe, it, expect } from 'vitest';
import { isImageExtension, isBinaryExtension } from './binaryExtensions';

describe('binaryExtensions helpers', () => {
  it('isImageExtension covers web + binary image formats', () => {
    // Web image (image/svg handler extensions)
    for (const ext of ['svg', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico']) {
      expect(isImageExtension(ext), ext).toBe(true);
    }
    // Binary image formats (no builtin viewer — would land in 'unsupported')
    for (const ext of ['tiff', 'tif', 'avif', 'heic', 'heif', 'jxl', 'psd', 'ai', 'eps']) {
      expect(isImageExtension(ext), ext).toBe(true);
    }
    // Case-insensitive
    expect(isImageExtension('PNG')).toBe(true);
    expect(isImageExtension('Svg')).toBe(true);
  });

  it('isImageExtension rejects non-image types', () => {
    for (const ext of ['txt', 'py', 'js', 'md', 'json', 'xlsx', 'docx', 'dbml', 'html']) {
      expect(isImageExtension(ext), ext).toBe(false);
    }
    expect(isImageExtension('')).toBe(false);
  });

  it('isBinaryExtension unchanged (regression guard)', () => {
    expect(isBinaryExtension('xlsx')).toBe(true);
    expect(isBinaryExtension('txt')).toBe(false);
  });
});
