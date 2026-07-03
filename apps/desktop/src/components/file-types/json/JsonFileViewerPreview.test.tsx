import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { JsonFileViewerPreview } from './JsonFileViewerPreview';

describe('JsonFileViewerPreview — scaffolding smoke test', () => {
  it('renders raw content with filename and line count', () => {
    const html = renderToString(
      <JsonFileViewerPreview content='{"a": 1}' filePath='/v/data.json' />,
    );
    expect(html).toContain('data.json');
    expect(html).toMatch(/&quot;a&quot;:\s*1/);
    expect(html).toMatch(/1<!--\s*-->\s*lines/);
  });

  it('falls back to data.json when filePath has no slash', () => {
    const html = renderToString(
      <JsonFileViewerPreview content='{"b": 2}' filePath='data.json' />,
    );
    expect(html).toContain('data.json');
  });

  it('handles empty content without crashing', () => {
    const html = renderToString(
      <JsonFileViewerPreview content='' filePath='/e/empty.json' />,
    );
    expect(html).toContain('empty.json');
    expect(html).toMatch(/0<!--\s*-->\s*lines/);
  });
});
