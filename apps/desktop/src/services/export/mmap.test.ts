/**
 * Focused regression test for the mmap export enhancer.
 *
 * Two historical bugs are pinned here:
 *  1. The enhancer transformed `ctx.src` (the file-preview directive's src
 *     PATH, e.g. "./map.mmap") directly — markmap-lib only builds nodes from
 *     markdown headings, so a path string yields an empty root and a blank
 *     export. It must read the real .mmap source first.
 *  2. The exported SVG was serialized through HTML (innerHTML/outerHTML),
 *     which emits markmap's foreignObject HTML void elements (<img>) unclosed
 *     — breaking standalone XML parsing. The enhancer must serialize via
 *     XMLSerializer and stash the well-formed bytes on data-raw-svg.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const SVG_NS = 'http://www.w3.org/2000/svg';
const XHTML_NS = 'http://www.w3.org/1999/xhtml';

// Hoisted so the vi.mock factories below (which Vitest lifts above the module
// body) can close over them.
const mocks = vi.hoisted(() => {
  const transform = vi.fn((_content: string) => ({ root: { content: 'Root', children: [] } }));
  const setData = vi.fn();
  const fit = vi.fn();
  const readFileByRoute = vi.fn();
  const create = vi.fn((svg: SVGSVGElement) => {
    // Simulate markmap-view's render: a foreignObject whose node content is
    // an HTML <img> (void element) inside an xhtml <div>.
    const fo = document.createElementNS(SVG_NS, 'foreignObject');
    fo.setAttribute('class', 'markmap-foreign');
    const outer = document.createElementNS(XHTML_NS, 'div');
    const inner = document.createElementNS(XHTML_NS, 'div');
    inner.innerHTML = '<img src="asset://localhost/img.png" alt="x">';
    outer.appendChild(inner);
    fo.appendChild(outer);
    svg.appendChild(fo);
    return { setData, fit };
  });
  return { transform, setData, fit, create, readFileByRoute };
});

vi.mock('markmap-lib', () => ({
  Transformer: class { transform = mocks.transform; },
}));
vi.mock('markmap-view', () => ({
  Markmap: { create: mocks.create },
}));
vi.mock('@/components/file-types/mmap/initMath', () => ({}));
vi.mock('@/services/editorIoService', () => ({
  readFileByRoute: mocks.readFileByRoute,
}));
vi.mock('@/components/file-types/previewPath', () => ({
  resolveAssetBase: vi.fn(async () => null),
}));
vi.mock('@/components/file-types/mmap/resolveImages', () => ({
  resolveImagesInTree: vi.fn(),
}));
vi.mock('./shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./shared')>();
  return {
    ...actual,
    inlineContainerImages: vi.fn(async () => {}),
  };
});

import { enhance } from './mmap';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('mmap export enhancer', () => {
  it('reads the .mmap file content and transforms it (not the src path)', async () => {
    mocks.readFileByRoute.mockResolvedValueOnce('# Title\n## Child');

    const body = document.createElement('div');
    await enhance(body, {
      src: './map.mmap',
      filePath: 'notes/map.mmap',
      vaultRoot: '/vault',
    });

    // The src path must be resolved relative to the directive's document and
    // read through the preview's own read path.
    expect(mocks.readFileByRoute).toHaveBeenCalledWith('notes/map.mmap');
    // markmap-lib receives the file content, never the "./map.mmap" path.
    expect(mocks.transform).toHaveBeenCalledWith('# Title\n## Child');
    expect(mocks.transform).not.toHaveBeenCalledWith('./map.mmap');
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.setData).toHaveBeenCalledTimes(1);
    expect(mocks.fit).toHaveBeenCalledTimes(1);
    // Blank-export regression: markmap must render synchronously (duration:0)
    // so d3 transitions (foreignObject opacity 0→1, node translate, fit zoom)
    // are all settled before the SVG is serialized.
    expect(mocks.create.mock.calls[0][1]).toEqual({ autoFit: true, duration: 0 });
  });

  it('stashes a well-formed XML SVG on data-raw-svg (void <img> self-closed)', async () => {
    mocks.readFileByRoute.mockResolvedValueOnce('# Root\n## Child\n![alt](./img.png)');

    const body = document.createElement('div');
    body.setAttribute('data-file-preview-body', '');
    await enhance(body, {
      src: './map.mmap',
      filePath: 'notes/map.mmap',
      vaultRoot: '/vault',
    });

    const raw = body.getAttribute('data-raw-svg');
    expect(raw).toBeTruthy();
    expect(raw!.startsWith('<svg')).toBe(true);

    // XML-serialized void elements are self-closed (no unclosed <img>).
    expect(raw).toMatch(/<img\b[^>]*\/>/);

    // A strict XML parse must succeed — no <parsererror>, unlike the old
    // HTML-serialized output that threw "Opening and ending tag mismatch".
    const parsed = new DOMParser().parseFromString(raw!, 'image/svg+xml');
    expect(parsed.querySelector('parsererror')).toBeNull();
    expect(parsed.querySelector('foreignObject img')).not.toBeNull();

    // The stashed bytes must survive the HTML round-trip (container.innerHTML
    // → DOMParser → getAttribute) byte-for-byte, matching how
    // renderFilePreviewToSvg recovers them.
    const html = body.outerHTML;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const recovered = doc.querySelector('[data-file-preview-body]')?.getAttribute('data-raw-svg');
    expect(recovered).toBe(raw);
  });

  it('bails out (no SVG) when the file cannot be read', async () => {
    mocks.readFileByRoute.mockRejectedValueOnce(new Error('read failed'));

    const body = document.createElement('div');
    await enhance(body, {
      src: './map.mmap',
      filePath: 'notes/map.mmap',
      vaultRoot: '/vault',
    });

    expect(mocks.transform).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(body.querySelector('svg')).toBeNull();
  });

  it('bails out when src is empty', async () => {
    const body = document.createElement('div');
    await enhance(body, { src: '', filePath: 'notes/map.mmap', vaultRoot: '/vault' });

    expect(mocks.readFileByRoute).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
