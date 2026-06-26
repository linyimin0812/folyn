import { describe, it, expect, beforeEach, vi } from 'vitest';

// Shared Tauri mocks are auto-loaded via test/setup.ts — no per-file vi.mock.
//
// useExport is a React hook (useCallback + zustand selectors) that cannot be
// invoked without a React render — which the AC explicitly excludes. Per the
// task's preferred fallback ("replicate the call sequence against mocked
// stores and assert outcomes"), these tests drive the hook's *underlying*
// logic: the store-derived content lookup and the HTML/Markdown document
// assembly, using the REAL escapeHtml + HTML_STYLES from exportService.
//
// Residual (not covered without React render): the hook's useCallback memo
// wiring and its store-selector subscriptions.

// Mock the heavy exportService helpers; keep real escapeHtml + HTML_STYLES.
vi.mock('@/services/exportService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/exportService')>();
  return {
    ...actual,
    renderMarkdownToHtml: vi.fn((md: string) => `<rendered>${md}</rendered>`),
    inlineImages: vi.fn(async (html: string) => html),
    downloadBlob: vi.fn(),
  };
});

import { escapeHtml, HTML_STYLES, renderMarkdownToHtml, inlineImages, downloadBlob } from '@/services/exportService';
import type { FileTab } from '@/store/editorStore';

function makeTab(overrides: Partial<FileTab>): FileTab {
  return {
    id: 't1',
    name: 'doc.md',
    path: 'notes/doc.md',
    content: '# hello',
    isDirty: false,
    fileType: 'markdown',
    ...overrides,
  } as FileTab;
}

// Replicates useExport's getActiveContent derivation against store state.
function getActiveContent(tabs: FileTab[], activeTabId: string | null) {
  const tab = tabs.find((t) => t.id === activeTabId);
  return {
    name: tab?.name ?? 'untitled.md',
    content: tab?.content ?? '',
    path: tab?.path ?? '',
  };
}

// Replicates useExport's exportMarkdown action.
function exportMarkdown(tabs: FileTab[], activeTabId: string | null) {
  const { name, content } = getActiveContent(tabs, activeTabId);
  const blob = { __blob: true, name, type: 'text/markdown;charset=utf-8', content };
  // The hook calls downloadBlob(blob, name); we mirror that.
  (downloadBlob as (b: unknown, n: string) => void)(blob, name);
}

// Replicates useExport's exportHtml action verbatim (same template + helpers).
async function exportHtml(
  tabs: FileTab[],
  activeTabId: string | null,
  vaultRoot: string,
) {
  const { name, content, path } = getActiveContent(tabs, activeTabId);
  const renderedBody = renderMarkdownToHtml(content);
  const inlinedBody = await inlineImages(renderedBody, vaultRoot, path);
  const htmlContent = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(name.replace(/\.md$/, ''))}</title>
  <style>${HTML_STYLES}</style>
</head>
<body>
${inlinedBody}
</body>
</html>`;
  const blob = { __blob: true, name: name.replace(/\.md$/, '.html'), type: 'text/html;charset=utf-8', content: htmlContent };
  (downloadBlob as (b: unknown, n: string) => void)(blob, name.replace(/\.md$/, '.html'));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useExport — getActiveContent derivation', () => {
  it('returns the active tab content/name/path', () => {
    const tabs = [makeTab({ id: 'a', name: 'alpha.md', content: 'A', path: 'a/alpha.md' })];
    expect(getActiveContent(tabs, 'a')).toEqual({
      name: 'alpha.md',
      content: 'A',
      path: 'a/alpha.md',
    });
  });

  it('falls back to untitled.md + empty content when no active tab', () => {
    expect(getActiveContent([], null)).toEqual({ name: 'untitled.md', content: '', path: '' });
  });

  it('falls back when activeTabId does not match any tab', () => {
    const tabs = [makeTab({ id: 'a', content: 'A' })];
    expect(getActiveContent(tabs, 'missing').content).toBe('');
    expect(getActiveContent(tabs, 'missing').name).toBe('untitled.md');
  });
});

describe('useExport — exportMarkdown', () => {
  it('downloads a markdown blob named after the active tab', () => {
    const tabs = [makeTab({ id: 'a', name: 'note.md', content: '# hi' })];
    exportMarkdown(tabs, 'a');
    expect(downloadBlob).toHaveBeenCalledTimes(1);
    const [blob, name] = (downloadBlob as unknown as (b: unknown, n: string) => void).mock.calls[0] as [
      { content: string; type: string },
      string,
    ];
    expect(name).toBe('note.md');
    expect(blob.content).toBe('# hi');
    expect(blob.type).toBe('text/markdown;charset=utf-8');
  });
});

describe('useExport — exportHtml', () => {
  it('assembles a full HTML document with escaped title, HTML_STYLES, and inlined body', async () => {
    const tabs = [makeTab({ id: 'a', name: 'report.md', content: '# Report', path: 'r/report.md' })];
    await exportHtml(tabs, 'a', '/vault');

    expect(renderMarkdownToHtml).toHaveBeenCalledWith('# Report');
    expect(inlineImages).toHaveBeenCalledWith(expect.any(String), '/vault', 'r/report.md');

    const [blob, name] = (downloadBlob as unknown as (b: unknown, n: string) => void).mock.calls[0] as [
      { content: string; type: string },
      string,
    ];
    expect(name).toBe('report.html');
    expect(blob.type).toBe('text/html;charset=utf-8');
    const html = blob.content;
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<title>report</title>');
    expect(html).toContain(`<style>${HTML_STYLES}</style>`);
    expect(html).toContain('<rendered># Report</rendered>');
  });

  it('escapes HTML special chars in the document title', async () => {
    const tabs = [makeTab({ id: 'a', name: '<script>.md', content: '' })];
    await exportHtml(tabs, 'a', '/vault');
    const html = (downloadBlob as unknown as (b: unknown, n: string) => void).mock.calls[0][0] as {
      content: string;
    };
    // Title derives from name minus .md -> "<script>" -> escaped.
    expect(html.content).toContain('<title>&lt;script&gt;</title>');
    expect(html.content).not.toContain('<title><script></title>');
  });

  it('uses an empty vaultRoot when the store has no current vault', async () => {
    const tabs = [makeTab({ id: 'a', name: 'x.md', content: 'c' })];
    await exportHtml(tabs, 'a', '');
    expect(inlineImages).toHaveBeenCalledWith(expect.any(String), '', 'notes/doc.md');
  });
});
