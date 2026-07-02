import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { CsvTablePreview } from './CsvTablePreview';

/**
 * `renderToString`-based tests for the CSV table preview. Mirrors the
 * repo's no-@testing-library/react discipline (see ClipCardView.test.tsx,
 * InfographicView.test.tsx).
 */

describe('CsvTablePreview', () => {
  it('renders a table with header and body cells for a simple CSV', () => {
    const html = renderToString(
      <CsvTablePreview content={'name,age\nAlice,30\nBob,25'} filePath="" vaultRoot="" />,
    );
    expect(html).toContain('<table');
    expect(html).toContain('<thead>');
    expect(html).toContain('<th');
    expect(html).toContain('name');
    expect(html).toContain('age');
    expect(html).toContain('<tbody>');
    expect(html).toContain('<td');
    expect(html).toContain('Alice');
    expect(html).toContain('30');
    expect(html).toContain('Bob');
    expect(html).toContain('25');
  });

  it('renders the empty hint when content is empty', () => {
    const html = renderToString(
      <CsvTablePreview content={''} filePath="" vaultRoot="" />,
    );
    expect(html).toContain('CSV 为空或无法解析');
    expect(html).not.toContain('<table');
  });

  it('renders only the empty hint for whitespace-only newline content without crashing', () => {
    // `\n` parses to a single empty-cell row; ensure it renders without crash.
    const html = renderToString(
      <CsvTablePreview content={'\n'} filePath="" vaultRoot="" />,
    );
    expect(html).toContain('<table');
  });

  it('unquotes quoted-field values when rendering', () => {
    const html = renderToString(
      <CsvTablePreview content={'"a,b",c\n"p""q",r'} filePath="" vaultRoot="" />,
    );
    // Quoted comma field should render the literal value with the comma.
    expect(html).toContain('a,b');
    // Escaped quote field should render a single quote (React escapes `"` in
    // text content to `&quot;`).
    expect(html).toContain('p&quot;q');
    expect(html).toContain('r');
  });

  it('renders jagged rows without crashing', () => {
    const html = renderToString(
      <CsvTablePreview content={'h1,h2,h3\na,b\nx'} filePath="" vaultRoot="" />,
    );
    expect(html).toContain('h1');
    expect(html).toContain('h3');
    expect(html).toContain('a');
    expect(html).toContain('b');
    expect(html).toContain('x');
  });

  it('renders a single header-only row as thead with no body rows', () => {
    const html = renderToString(
      <CsvTablePreview content={'col1,col2'} filePath="" vaultRoot="" />,
    );
    expect(html).toContain('<thead>');
    expect(html).toContain('col1');
    expect(html).toContain('col2');
    // tbody still present but empty — ensure no body cell rendered.
    expect(html).not.toContain('<td');
  });
});
