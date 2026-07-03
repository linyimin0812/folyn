import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';

type Captured = { parts: BlobPart[]; name: string; options?: FilePropertyBag } | null;
let captured: Captured = null;

class MockFile implements File {
  parts: BlobPart[];
  name: string;
  options?: FilePropertyBag;
  constructor(parts: BlobPart[], name: string, options?: FilePropertyBag) {
    this.parts = parts;
    this.name = name;
    this.options = options;
    captured = { parts, name, options };
  }
  get size() { return 0; }
  get type() { return this.options?.type ?? ''; }
  get lastModified() { return 0; }
  get webkitRelativePath() { return ''; }
  arrayBuffer(): Promise<ArrayBuffer> { return Promise.resolve(new ArrayBuffer(0)); }
  text(): Promise<string> { return Promise.resolve(String(this.parts[0] ?? '')); }
  slice(): Blob { return new MockFile([], ''); }
  stream(): ReadableStream<Uint8Array> { return new ReadableStream(); }
}

vi.stubGlobal('File', MockFile);
vi.mock('@file-viewer/react', () => ({
  default: () => null,
}));
vi.mock('@file-viewer/preset-office', () => ({ default: {} }));

import { CsvFileViewerPreview } from './CsvFileViewerPreview';

const firstPartText = (): string => {
  if (!captured) throw new Error('File not constructed');
  const part = captured.parts[0];
  return typeof part === 'string' ? part : '';
};

describe('CsvFileViewerPreview — BOM prepending', () => {
  beforeEach(() => { captured = null; });

  it('prepends UTF-8 BOM for content without BOM (SheetJS UTF-8 path)', () => {
    renderToString(
      <CsvFileViewerPreview content="姓名,年龄\n张三,30" filePath="/v/data.csv" />,
    );
    expect(firstPartText().startsWith('\uFEFF')).toBe(true);
    expect(firstPartText().endsWith('张三,30')).toBe(true);
    expect(captured!.name).toBe('data.csv');
    expect(captured!.options?.type).toBe('text/csv');
  });

  it('does not double-prefix when content already starts with BOM', () => {
    const body = '\uFEFF姓名,年龄\n李四,40';
    renderToString(<CsvFileViewerPreview content={body} filePath="/x/list.csv" />);
    const text = firstPartText();
    expect(text.startsWith('\uFEFF\uFEFF')).toBe(false);
    expect(text.startsWith('\uFEFF姓名')).toBe(true);
  });

  it('handles empty content by still emitting a single BOM', () => {
    renderToString(<CsvFileViewerPreview content="" filePath="/e/empty.csv" />);
    expect(firstPartText()).toBe('\uFEFF');
  });

  it('falls back to data.csv when filePath has no slash', () => {
    renderToString(<CsvFileViewerPreview content="a,b" filePath="data.csv" />);
    expect(captured!.name).toBe('data.csv');
  });
});
