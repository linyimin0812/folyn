import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';

// Shared Tauri mocks (@tauri-apps/plugin-fs, @tauri-apps/plugin-shell) are
// installed via resolve.alias in vitest.workspace.ts and reset between
// tests by test/setup.ts.

import { mkdir as mockedMkdir, writeFile as mockedWriteFile, __internals as fsInternals } from '@tauri-apps/plugin-fs';

import {
  DEFAULT_MAX_BYTES,
  DEFAULT_ALLOWED_TYPES,
  ATTACHMENTS_SUBDIR,
  isImageFile,
  validateFile,
  buildReadInstructions,
  buildRigPrompt,
  blobToRigImage,
  revokeUrls,
  addFiles,
  handlePaste,
  saveBlobs,
} from './attachments';
import type { PendingAttachment } from './attachments';

// ── jsdom polyfills ─────────────────────────────────────
// jsdom does not ship URL.createObjectURL / revokeObjectURL or
// Blob.prototype.arrayBuffer. Install deterministic stubs so the helper's
// object-URL and blob-write paths can be exercised. Individual tests spy
// on these to assert call counts/args.

const createObjectURLMock = vi.fn((_blob: Blob) => 'blob:mock');
const revokeObjectURLMock = vi.fn((_url: string) => {});

beforeAll(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const urlAny = URL as any;
  if (typeof urlAny.createObjectURL !== 'function') {
    urlAny.createObjectURL = createObjectURLMock;
  }
  if (typeof urlAny.revokeObjectURL !== 'function') {
    urlAny.revokeObjectURL = revokeObjectURLMock;
  }
});

// ── platform isTauri mock ───────────────────────────────
// isTauri() is read at runtime inside saveBlobsFs; toggle the flag to test
// the non-Tauri guard without affecting the default (Tauri=true) path.
const platformMock = vi.hoisted(() => ({ isTauri: (): boolean => true }));
vi.mock('@/utils/platform', () => ({ isTauri: () => platformMock.isTauri() }));

// ── helpers ─────────────────────────────────────────────

function makeFile(name: string, content: string, type = ''): File {
  return new File([content], name, { type });
}

function makeImageFile(name = 'pic.png', bytes = 8): File {
  const content = 'x'.repeat(bytes);
  return new File([content], name, { type: 'image/png' });
}

function makeBinaryFile(name: string, bytes: number, type = 'application/octet-stream'): File {
  const buf = new Uint8Array(bytes);
  return new File([buf], name, { type });
}

/** A blob stub whose `arrayBuffer()` resolves to a deterministic buffer
 *  (jsdom Blob lacks arrayBuffer). Carries `type`/`size` for deriveExtension. */
function makeBlob(content: string, type = ''): Blob {
  const bytes = new TextEncoder().encode(content);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return {
    size: bytes.length,
    type,
    arrayBuffer: () => Promise.resolve(buffer),
  } as unknown as Blob;
}

function makeImageBlob(bytes = 8, type = 'image/png'): Blob {
  return makeBlob('x'.repeat(bytes), type);
}

/** Minimal ClipboardEvent stub: jsdom's ClipboardEvent doesn't let us
 *  synthesize DataTransferItemList with file items, so build the shape
 *  `handlePaste` actually reads. */
function makePasteEvent(items: { kind: 'file' | 'string'; type: string; file?: File | null }[]): {
  clipboardData: { items: { kind: string; type: string; getAsFile: () => File | null }[] };
  preventDefault: ReturnType<typeof vi.fn>;
} {
  return {
    clipboardData: {
      items: items.map((it) => ({
        kind: it.kind,
        type: it.type,
        getAsFile: () => it.file ?? null,
      })),
    },
    preventDefault: vi.fn(),
  } as never;
}

// ── tests ───────────────────────────────────────────────

beforeEach(() => {
  fsInternals.reset();
  createObjectURLMock.mockClear();
  revokeObjectURLMock.mockClear();
  vi.clearAllMocks();
  platformMock.isTauri = () => true;
});

describe('isImageFile', () => {
  it('returns true for image mime', () => {
    expect(isImageFile(new File([Buffer.from('x')], 'a.png', { type: 'image/png' }))).toBe(true);
    expect(isImageFile(new File([Buffer.from('x')], 'a.jpg', { type: 'image/jpeg' }))).toBe(true);
  });

  it('returns true for image extension when mime is empty', () => {
    expect(isImageFile(new File([Buffer.from('x')], 'photo.gif', { type: '' }))).toBe(true);
    expect(isImageFile(new File([Buffer.from('x')], 'PHOTO.JPG', { type: '' }))).toBe(true);
  });

  it('returns false for non-image files', () => {
    expect(isImageFile(new File([Buffer.from('x')], 'note.md', { type: 'text/markdown' }))).toBe(false);
    expect(isImageFile(new File([Buffer.from('x')], 'data.json', { type: 'application/json' }))).toBe(false);
  });
});

describe('validateFile', () => {
  it('accepts a file within limits and whitelist', () => {
    expect(validateFile(makeFile('a.md', 'hi', 'text/markdown'))).toEqual({ ok: true });
  });

  it('accepts image/* tokens', () => {
    expect(validateFile(makeImageFile('a.png', 4))).toEqual({ ok: true });
  });

  it('rejects oversize files', () => {
    const big = makeBinaryFile('big.txt', DEFAULT_MAX_BYTES + 1, 'text/plain');
    const res = validateFile(big);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/超过/);
    expect(res.error).toMatch(/MB/);
  });

  it('respects a custom maxBytes', () => {
    const res = validateFile(makeBinaryFile('a.txt', 200, 'text/plain'), { maxBytes: 100 });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/超过/);
  });

  it('rejects non-whitelist types', () => {
    const res = validateFile(makeFile('a.exe', 'MZ', 'application/x-msdownload'));
    expect(res.ok).toBe(false);
    expect(res.error).toBe('不支持的文件类型');
  });

  it('accepts .md by extension even with empty mime', () => {
    expect(validateFile(makeFile('a.md', 'hi', ''))).toEqual({ ok: true });
  });

  it('honors a custom allowedTypes list', () => {
    expect(validateFile(makeFile('a.md', 'hi', ''), { allowedTypes: ['.txt'] }).ok).toBe(false);
    expect(validateFile(makeFile('a.txt', 'hi', ''), { allowedTypes: ['.txt'] }).ok).toBe(true);
  });

  it('DEFAULT_ALLOWED_TYPES mirrors AiPanel accept', () => {
    expect(DEFAULT_ALLOWED_TYPES).toEqual([
      'image/*',
      '.txt',
      '.md',
      '.json',
      '.csv',
      '.pdf',
      '.html',
      '.htm',
      '.xml',
      '.yaml',
      '.yml',
      '.toml',
      '.log',
    ]);
  });
});

describe('buildReadInstructions', () => {
  it('returns the prompt unchanged when there are no attachments', () => {
    expect(buildReadInstructions([], 'hello')).toBe('hello');
    expect(buildReadInstructions([], '')).toBe('');
  });

  it('builds an image-only block', () => {
    const out = buildReadInstructions(
      [{ name: 'a.png', path: '/tmp/a.png', type: 'image' }],
      'hi',
    );
    expect(out).toBe(`请先使用 Read 工具读取以下图片文件:\n/tmp/a.png\n\n用户消息: hi`);
  });

  it('builds a file-only block', () => {
    const out = buildReadInstructions(
      [{ name: 'n.md', path: '/v/n.md', type: 'file' }],
      'hi',
    );
    expect(out).toBe(`请先使用 Read 工具读取以下文件:\n/v/n.md\n\n用户消息: hi`);
  });

  it('builds both blocks (images first) joined by \\n\\n', () => {
    const out = buildReadInstructions(
      [
        { name: 'a.png', path: '/i/a.png', type: 'image' },
        { name: 'b.png', path: '/i/b.png', type: 'image' },
        { name: 'n.md', path: '/v/n.md', type: 'file' },
      ],
      'hi',
    );
    expect(out).toBe(
      `请先使用 Read 工具读取以下图片文件:\n/i/a.png\n/i/b.png\n\n请先使用 Read 工具读取以下文件:\n/v/n.md\n\n用户消息: hi`,
    );
  });

  it('returns the instruction alone when prompt is empty', () => {
    const out = buildReadInstructions(
      [{ name: 'a.png', path: '/i/a.png', type: 'image' }],
      '',
    );
    expect(out).toBe(`请先使用 Read 工具读取以下图片文件:\n/i/a.png`);
  });

  it('joins multiple paths within a block with \\n', () => {
    const out = buildReadInstructions(
      [
        { name: 'a.txt', path: '/a.txt', type: 'file' },
        { name: 'b.txt', path: '/b.txt', type: 'file' },
      ],
      'go',
    );
    expect(out).toContain('/a.txt\n/b.txt');
  });
});

describe('buildRigPrompt', () => {
  it('uses the placeholder when only images are attached (no Read tool in chat mode)', () => {
    const saved: SavedAttachment[] = [
      { name: 'pic.png', path: '/work/.mochi-tmp/pic.png', type: 'image' },
    ];
    expect(buildRigPrompt('', saved, '(附件)')).toBe('(附件)');
  });

  it('keeps user text unchanged when images accompany text', () => {
    const saved: SavedAttachment[] = [
      { name: 'pic.png', path: '/x/pic.png', type: 'image' },
    ];
    expect(buildRigPrompt('看看这张图', saved, '(附件)')).toBe('看看这张图');
  });

  it('keeps a Read hint for non-image files but excludes image paths', () => {
    const saved: SavedAttachment[] = [
      { name: 'a.md', path: '/x/a.md', type: 'file' },
      { name: 'pic.png', path: '/x/pic.png', type: 'image' },
    ];
    const out = buildRigPrompt('读一下', saved, '(附件)');
    expect(out).toContain('请先使用 Read 工具读取以下文件');
    expect(out).toContain('/x/a.md');
    expect(out).toContain('用户消息: 读一下');
    expect(out).not.toContain('/x/pic.png');
  });
});

describe('blobToRigImage', () => {
  it('converts a blob to {data, mediaType} without the data: URL prefix', async () => {
    const blob = new Blob(['hello'], { type: 'image/png' });
    const img = await blobToRigImage(blob);
    expect(img.mediaType).toBe('image/png');
    expect(img.data).toBeTruthy();
    expect(atob(img.data)).toBe('hello');
  });
});

describe('revokeUrls', () => {
  it('revokes each previewUrl', () => {
    const atts: PendingAttachment[] = [
      { id: '1', name: 'a', type: 'image', previewUrl: 'blob:1' },
      { id: '2', name: 'b', type: 'image', previewUrl: 'blob:2' },
      { id: '3', name: 'c', type: 'file' },
    ];
    revokeUrls(atts);
    expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:1');
    expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:2');
    expect(revokeObjectURLMock).toHaveBeenCalledTimes(2);
  });

  it('is a no-op when no previewUrls are present', () => {
    revokeUrls([{ id: '1', name: 'a', type: 'file' }]);
    expect(revokeObjectURLMock).not.toHaveBeenCalled();
  });
});

describe('addFiles', () => {
  it('accepts valid files and rejects invalid ones, returning both lists', () => {
    const good = makeFile('ok.md', 'hi', 'text/markdown');
    const big = makeBinaryFile('big.txt', DEFAULT_MAX_BYTES + 1, 'text/plain');
    const bad = makeFile('evil.exe', 'MZ', 'application/x-msdownload');
    const { accepted, rejected } = addFiles([good, big, bad]);
    expect(accepted).toHaveLength(1);
    expect(accepted[0].name).toBe('ok.md');
    expect(accepted[0].type).toBe('file');
    expect(accepted[0].blob).toBeInstanceOf(Blob);
    expect(accepted[0].path).toBeUndefined();
    expect(accepted[0].previewUrl).toBeUndefined();
    expect(rejected).toHaveLength(2);
    expect(rejected.map((r) => r.name).sort()).toEqual(['big.txt', 'evil.exe']);
  });

  it('gives image attachments a previewUrl and type image', () => {
    const { accepted } = addFiles([makeImageFile('pic.png', 4)]);
    expect(accepted).toHaveLength(1);
    expect(accepted[0].type).toBe('image');
    expect(accepted[0].previewUrl).toBe('blob:mock');
    expect(createObjectURLMock).toHaveBeenCalled();
  });

  it('uses a custom idGenerator when provided', () => {
    const { accepted } = addFiles([makeFile('a.md', 'hi', 'text/markdown')], {
      idGenerator: () => 'fixed-id',
    });
    expect(accepted[0].id).toBe('fixed-id');
  });

  it('accepts a FileList (DOM interface) as well as an array', () => {
    const good = makeFile('a.md', 'hi', 'text/markdown');
    const fileList = {
      length: 1,
      0: good,
      item: (i: number) => (i === 0 ? good : null),
      [Symbol.iterator]: function* () {
        yield good;
      },
    } as unknown as FileList;
    const { accepted } = addFiles(fileList);
    expect(accepted).toHaveLength(1);
  });
});

describe('handlePaste', () => {
  it('extracts an image attachment from a paste event', () => {
    const img = makeImageFile('clip.png', 4);
    const e = makePasteEvent([{ kind: 'file', type: 'image/png', file: img }]);
    const { accepted, rejected } = handlePaste(e);
    expect(accepted).toHaveLength(1);
    expect(accepted[0].type).toBe('image');
    expect(accepted[0].blob).toBe(img);
    expect(accepted[0].previewUrl).toBe('blob:mock');
    expect(accepted[0].name).toMatch(/^paste-\d+\.png$/);
    expect(rejected).toHaveLength(0);
  });

  it('returns empty for non-image paste', () => {
    const e = makePasteEvent([{ kind: 'file', type: 'text/plain', file: makeFile('a.txt', 'hi', 'text/plain') }]);
    const { accepted, rejected } = handlePaste(e);
    expect(accepted).toHaveLength(0);
    expect(rejected).toHaveLength(0);
  });

  it('rejects an oversize pasted image', () => {
    const big = makeBinaryFile('huge.png', DEFAULT_MAX_BYTES + 1, 'image/png');
    const e = makePasteEvent([{ kind: 'file', type: 'image/png', file: big }]);
    const { accepted, rejected } = handlePaste(e);
    expect(accepted).toHaveLength(0);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].error).toMatch(/超过/);
  });

  it('does not throw when clipboardData is missing', () => {
    const e = { clipboardData: undefined, preventDefault: vi.fn() } as never;
    const { accepted, rejected } = handlePaste(e);
    expect(accepted).toHaveLength(0);
    expect(rejected).toHaveLength(0);
  });
});

describe('saveBlobs', () => {
  describe('fs strategy (default)', () => {
    it('writes each blob to <workingDir>/attachments/<id>-<name>.<ext> via plugin-fs', async () => {
      const atts: PendingAttachment[] = [
        { id: 'id1', name: 'pic.png', type: 'image', blob: makeImageBlob(4, 'image/png') },
        { id: 'id2', name: 'note.md', type: 'file', blob: makeBlob('hi', 'text/markdown') },
      ];
      const saved = await saveBlobs(atts, '/work');
      expect(saved).toHaveLength(2);
      expect(saved[0].path).toMatch(/^\/work\/attachments\/id1-pic\.png$/);
      expect(saved[0].type).toBe('image');
      expect(saved[1].path).toMatch(/^\/work\/attachments\/id2-note\.md$/);
      expect(saved[1].type).toBe('file');
      expect(mockedMkdir).toHaveBeenCalledWith('/work/attachments', { recursive: true });
      expect(mockedWriteFile).toHaveBeenCalledTimes(2);
      // Each writeFile call gets (path, Uint8Array).
      for (const call of mockedWriteFile.mock.calls) {
        expect(call[0]).toMatch(/^\/work\/attachments\//);
        expect(call[1]).toBeInstanceOf(Uint8Array);
      }
    });

    it('passes path-only attachments through unchanged', async () => {
      const atts: PendingAttachment[] = [
        { id: 'p1', name: 'vault.md', type: 'file', path: '/vault/vault.md' },
      ];
      const saved = await saveBlobs(atts, '/work');
      expect(saved).toEqual([{ name: 'vault.md', path: '/vault/vault.md', type: 'file' }]);
      expect(mockedWriteFile).not.toHaveBeenCalled();
    });

    it('revokes previewUrl after writing the blob', async () => {
      const atts: PendingAttachment[] = [
        { id: 'id1', name: 'pic.png', type: 'image', blob: makeImageBlob(4, 'image/png'), previewUrl: 'blob:preview' },
      ];
      await saveBlobs(atts, '/work');
      expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:preview');
    });

    it('honors a custom subdir', async () => {
      const atts: PendingAttachment[] = [
        { id: 'id1', name: 'pic.png', type: 'image', blob: makeImageBlob(4, 'image/png') },
      ];
      await saveBlobs(atts, '/work', { subdir: 'tmp' });
      expect(mockedMkdir).toHaveBeenCalledWith('/work/tmp', { recursive: true });
    });

    it('throws when not running inside Tauri', async () => {
      platformMock.isTauri = () => false;
      await expect(
        saveBlobs(
          [{ id: 'id1', name: 'pic.png', type: 'image', blob: makeImageBlob(4, 'image/png') }],
          '/work',
        ),
      ).rejects.toThrow(/Tauri/);
    });

    it('writes large blobs through the fs plugin (no argv/E2BIG path)', async () => {
      // Regression: the old shell strategy embedded the whole base64 payload
      // in a `claude-cli` command-line argument, so sizeable images failed
      // with "Argument list too long (os error 7)". The fs path receives the
      // raw bytes and never spawns a shell command.
      const big = makeBlob('x'.repeat(2 * 1024 * 1024), 'image/png');
      const atts: PendingAttachment[] = [
        { id: 'big1', name: 'big.png', type: 'image', blob: big },
      ];
      const saved = await saveBlobs(atts, '/work');
      expect(saved).toHaveLength(1);
      expect(saved[0].path).toBe('/work/attachments/big1-big.png');
      expect(mockedWriteFile).toHaveBeenCalledWith(
        '/work/attachments/big1-big.png',
        expect.any(Uint8Array),
      );
    });
  });
});

describe('ATTACHMENTS_SUBDIR', () => {
  it('is "attachments"', () => {
    expect(ATTACHMENTS_SUBDIR).toBe('attachments');
  });
});
