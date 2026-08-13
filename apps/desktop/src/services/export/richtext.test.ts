import { describe, it, expect } from 'vitest';
import { richTextToHtmlBlob } from './richtext';

// ponytail: jsdom's Blob has no .text() — read via FileReader (jsdom exposes
// it in the test env). Mirrors how the app's export consumer reads the blob.
function blobToText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

const TABLE_DOC = JSON.stringify({
  type: 'doc',
  content: [
    {
      type: 'table',
      content: [
        {
          type: 'tableRow',
          content: [
            { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }] },
            { type: 'tableHeader', content: [{ type: 'paragraph' }] },
          ],
        },
      ],
    },
  ],
});

describe('rich-text HTML export', () => {
  it('embeds the empty-cell row-height CSS rule for standalone HTML', async () => {
    const blob = await richTextToHtmlBlob(TABLE_DOC, 'x.rt', '');
    const text = await blobToText(blob);
    // Contract: tiptap serializes an empty cell as <td><p></p></td>; the
    // export CSS must keep it tall via :empty::after nbsp injection.
    expect(text).toContain('<td');
    expect(text).toContain('td:empty::after');
    expect(text).toContain('td p:empty::after');
    expect(text).toContain('content: "\\00a0"');
  });
});
