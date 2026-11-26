// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { createElement } from 'react';
import { TableFocusWrap } from './TableFocusWrap';

const tableRows = [
  createElement('thead', { key: 'h' }, createElement('tr', null,
    createElement('th', null, '字段'),
    createElement('th', null, '值'),
  )),
  createElement('tbody', { key: 'b' }, createElement('tr', null,
    createElement('td', null, '名称'),
    createElement('td', null, 'Folyn'),
  )),
];

const wrap = (line: number | undefined) =>
  createElement(TableFocusWrap, { sourceLine: line, tableProps: { 'data-source-line': 7 } }, tableRows);

describe('TableFocusWrap', () => {
  afterEach(cleanup);

  it('keeps the DOM contract: root data-source-line → .md-table-wrap → table last', () => {
    const { container } = render(wrap(7));
    const outer = container.querySelector('.md-table-outer')!;
    expect(outer.getAttribute('data-source-line')).toBe('7');
    const inner = outer.querySelector('.md-table-wrap')!;
    expect(inner.querySelector('table[data-source-line="7"]')).not.toBeNull();
    // table is the last element child of the wrap (cursor-sync tie-break).
    const last = inner.lastElementChild!;
    expect(last.tagName).toBe('TABLE');
  });

  it('opens the focus view from the hover entry and closes on Escape', () => {
    const { container } = render(wrap(7));
    expect(document.body.querySelector('.md-code-focus-overlay')).toBeNull();
    fireEvent.click(container.querySelector('[aria-label="focus table view"]')!);
    const overlay = document.body.querySelector('.md-code-focus-overlay')!;
    expect(overlay.querySelector('.md-code-focus-head')?.textContent).toContain('表格 · 第 7 行');
    // The focused body re-renders the table inside a .md-table-wrap frame.
    const body = overlay.querySelector('.md-focus-table-body')!;
    expect(body.querySelector('.md-table-wrap table')).not.toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(document.body.querySelector('.md-code-focus-overlay')).toBeNull();
    // Flow table untouched.
    expect(container.querySelector('.md-table-outer table')).not.toBeNull();
  });

  it('copy action writes the table as TSV', async () => {
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    const { container } = render(wrap(7));
    fireEvent.click(container.querySelector('[aria-label="focus table view"]')!);
    fireEvent.click(document.body.querySelector('[aria-label="copy table as tsv"]')!);
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0][0]).toBe('字段\t值\n名称\tFolyn');
  });

  it('falls back to a bare title when the source line is unknown', () => {
    const { container } = render(wrap(undefined));
    fireEvent.click(container.querySelector('[aria-label="focus table view"]')!);
    expect(document.body.querySelector('.md-code-focus-head')?.textContent).toContain('表格');
  });
});
