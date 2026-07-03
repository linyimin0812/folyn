// @vitest-environment jsdom
/**
 * JsonFileViewerPreview — PR3 integration tests.
 *
 * Covers:
 *   - Renders tree for valid JSON content.
 *   - Renders tree for JSON5 (comments + unquoted keys).
 *   - Shows error banner on invalid content.
 *   - Switching input-mode dropdown to YAML re-parses as YAML.
 *   - Clicking expand-all expands collapsed subtrees.
 *   - Toggling auto-sort ON sorts keys on next parse.
 *   - Switching to Query/Convert/Diff tab shows "coming in PR*" placeholder.
 *
 * Mocks:
 *   - `@tauri-apps/plugin-clipboard-manager` — stubbed so the dynamic
 *     import in the component resolves to a noop.
 *   - The clipboard write is not asserted here; PR8 covers wiring.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
  cleanup,
  within,
} from '@testing-library/react';

const writeTextMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
  writeText: writeTextMock,
}));

import { JsonFileViewerPreview } from './JsonFileViewerPreview';

/** Get the rendered JsonTree container; fails the test if absent. */
function getTree(): HTMLElement {
  const el = document.querySelector('[data-testid="json-tree"]');
  if (!el) throw new Error('json-tree container not rendered');
  return el as HTMLElement;
}

/**
 * JsonTree is keyed by `parsedValueVersion` so it remounts on each parse.
 * Therefore the data-testid container is replaced after each parse — always
 * re-query via `getTree()` inside `waitFor`, never cache the reference.
 */

describe('JsonFileViewerPreview — PR3', () => {
  beforeEach(() => {
    writeTextMock.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the tree with top-level keys for valid JSON', async () => {
    await act(async () => {
      render(
        <JsonFileViewerPreview
          content='{"users":[{"name":"Alice"}],"count":1}'
          filePath='/v/data.json'
        />,
      );
    });
    await waitFor(() => {
      expect(within(getTree()).getByText('users')).toBeTruthy();
      expect(within(getTree()).getByText('count')).toBeTruthy();
    });
    // Type badges are present.
    expect(within(getTree()).getByText('arr')).toBeTruthy();
    expect(within(getTree()).getByText('num')).toBeTruthy();
  });

  it('renders the tree for JSON5 with comments and unquoted keys', async () => {
    const json5 = `{
  // a comment
  name: "Quill",
  /* block */
  count: 3,
}`;
    await act(async () => {
      render(<JsonFileViewerPreview content={json5} filePath='/v/data.json' />);
    });
    await waitFor(() => {
      expect(within(getTree()).getByText('name')).toBeTruthy();
      expect(within(getTree()).getByText('count')).toBeTruthy();
    });
  });

  it('shows the error banner on invalid content', async () => {
    await act(async () => {
      render(
        <JsonFileViewerPreview content='@@@ not any format @@@' filePath='/v/bad.json' />,
      );
    });
    await waitFor(() => {
      expect(screen.getByText(/解析失败/)).toBeTruthy();
    });
  });

  it('re-parses as YAML when input-mode dropdown switches to YAML', async () => {
    const yaml = 'name: Alice\nage: 30';
    let view: ReturnType<typeof render>;
    await act(async () => {
      view = render(<JsonFileViewerPreview content={yaml} filePath='/v/data.json' />);
    });
    await waitFor(() => {
      expect(within(getTree()).getByText('name')).toBeTruthy();
    });

    // Switch dropdown to YAML explicitly — should still parse and show keys.
    const select = view!.getByDisplayValue('Auto') as HTMLSelectElement;
    await act(async () => {
      fireEvent.change(select, { target: { value: 'yaml' } });
    });
    await waitFor(() => {
      expect(within(getTree()).getByText('name')).toBeTruthy();
      expect(within(getTree()).getByText('age')).toBeTruthy();
    });
  });

  it('expands all collapsed subtrees on 全部展开 click', async () => {
    // Nested deep enough that depth-2+ nodes are collapsed by default.
    const nested = '{"a":{"b":{"c":"deep"}}}';
    let view: ReturnType<typeof render>;
    await act(async () => {
      view = render(<JsonFileViewerPreview content={nested} filePath='/v/data.json' />);
    });
    await waitFor(() => {
      expect(within(getTree()).getByText('a')).toBeTruthy();
    });
    // "deep" is at depth 3 → collapsed under default expand depth = 1.
    const expandBtn = view!.getByText('全部展开');
    await act(async () => {
      fireEvent.click(expandBtn);
    });
    await waitFor(() => {
      expect(within(getTree()).getByText('deep')).toBeTruthy();
    });
  });

  it('sorts keys alphabetically when auto-sort is ON before next parse', async () => {
    // Keys in non-sorted order.
    const unsorted = '{"zebra":1,"apple":2,"mango":3}';
    let view: ReturnType<typeof render>;
    await act(async () => {
      view = render(<JsonFileViewerPreview content={unsorted} filePath='/v/data.json' />);
    });
    await waitFor(() => {
      expect(within(getTree()).getByText('zebra')).toBeTruthy();
    });

    // Toggle auto-sort ON.
    const sortToggle = view!.getByText('自动排序');
    await act(async () => {
      fireEvent.click(sortToggle);
    });

    // Trigger a re-parse by sending new content via the CodeMirror editor.
    // The CM content element is a contenteditable `.cm-content`; we
    // dispatch an input event with a new textContent to simulate typing.
    // (CM6's mutation observer picks up DOM changes in jsdom.)
    const cmContent = view!.container.querySelector('.cm-content') as HTMLElement | null;
    if (cmContent) {
      await act(async () => {
        cmContent.focus();
        fireEvent.input(cmContent, {
          target: { textContent: '{ "zebra": 1, "apple": 2, "mango": 3 }' },
        });
      });
    }
    // Also fall back to re-rendering with new `content` to ensure re-parse.
    await act(async () => {
      view!.rerender(
        <JsonFileViewerPreview
          content='{ "zebra": 1, "apple": 2, "mango": 3 }'
          filePath='/v/data.json'
        />,
      );
    });

    // After debounce + parse, keys should be sorted: apple, mango, zebra.
    await waitFor(
      () => {
        const keys = within(getTree())
          .getAllByText(/^(zebra|apple|mango)$/)
          .map((el) => el.textContent);
        expect(keys).toEqual(['apple', 'mango', 'zebra']);
      },
      { timeout: 2000 },
    );
  });

  it('enables Query / Convert / Diff tabs (PR4-6 wired)', async () => {
    let view: ReturnType<typeof render>;
    await act(async () => {
      view = render(<JsonFileViewerPreview content='{"a":1}' filePath='/v/data.json' />);
    });
    await waitFor(() => {
      expect(within(getTree()).getByText('a')).toBeTruthy();
    });

    // PR4-6: all tabs are now enabled.
    const queryTab = view!.getByText('Query') as HTMLButtonElement;
    expect(queryTab.disabled).toBe(false);

    const convertTab = view!.getByText('Convert') as HTMLButtonElement;
    expect(convertTab.disabled).toBe(false);

    const diffTab = view!.getByText('Diff') as HTMLButtonElement;
    expect(diffTab.disabled).toBe(false);
  });
});
