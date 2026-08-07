import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import React from 'react';
import plantumlEncoder from 'plantuml-encoder';
import { PlantUmlPreview, exportPlantUmlSvg } from '../src/index';

const makeEl = (props: { content: string; filePath?: string; vaultRoot?: string }) =>
  React.createElement(PlantUmlPreview, { content: props.content, filePath: props.filePath ?? 'x.puml', vaultRoot: props.vaultRoot ?? '/' });

describe('PlantUmlPreview', () => {
  it('renders an img with the encoded plantuml URL', () => {
    const content = '@startuml\nA -> B\n@enduml';
    const { container } = render(makeEl({ content }));
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    const expected = 'https://www.plantuml.com/plantuml/svg/' + plantumlEncoder.encode(content);
    expect(img!.getAttribute('src')).toBe(expected);
  });

  it('debounces content changes (does not flicker synchronously)', async () => {
    const content1 = '@startuml\nA -> B\n@enduml';
    const content2 = '@startuml\nA -> C\n@enduml';
    const { container, rerender } = render(makeEl({ content: content1 }));
    const srcBefore = container.querySelector('img')!.getAttribute('src');

    rerender(makeEl({ content: content2 }));
    const srcAfterImmediate = container.querySelector('img')!.getAttribute('src');
    expect(srcAfterImmediate).toBe(srcBefore);

    await new Promise((r) => setTimeout(r, 350));
    const srcFinal = container.querySelector('img')!.getAttribute('src');
    expect(srcFinal).toBe('https://www.plantuml.com/plantuml/svg/' + plantumlEncoder.encode(content2));
  });

  it('falls back to error view when onError fires', () => {
    const content = '@startuml\nA -> B\n@enduml';
    const { container } = render(makeEl({ content }));
    const img = container.querySelector('img')!;
    fireEvent.error(img);
    const errorEl = container.querySelector('.plantuml-error');
    expect(errorEl).not.toBeNull();
    expect(errorEl!.textContent).toContain('PlantUML rendering failed');
  });

  it('toolbar has zoom controls but no SVG export button', () => {
    const content = '@startuml\nA -> B\n@enduml';
    const { container } = render(makeEl({ content }));
    const buttons = Array.from(container.querySelectorAll('button')).map((b) => b.textContent);
    expect(buttons).toEqual(['−', '+']);
    expect(buttons).not.toContain('SVG');
  });
});

describe('exportPlantUmlSvg', () => {
  it('fetches the encoded svg URL and returns a Blob with image/svg+xml type', async () => {
    const content = '@startuml\nA -> B\n@enduml';
    const svgText = '<svg></svg>';
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(svgText) });
    (globalThis as any).fetch = fetchMock;

    const blob = await exportPlantUmlSvg(content, { filePath: 'notes/d.puml', vaultRoot: '/' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toBe('https://www.plantuml.com/plantuml/svg/' + plantumlEncoder.encode(content));
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/svg+xml');
    const text = await new Promise<string>((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.readAsText(blob);
    });
    expect(text).toBe(svgText);
  });

  it('throws on non-2xx response', async () => {
    (globalThis as any).fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    await expect(
      exportPlantUmlSvg('@startuml\nA -> B\n@enduml', { filePath: 'x.puml', vaultRoot: '/' }),
    ).rejects.toThrow(/HTTP 500/);
  });
});
