// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import grapesjs, { type Editor } from 'grapesjs';
import blocksBasic from 'grapesjs-blocks-basic';
import { registerCustomBlocks } from './grapesBlocks';

/**
 * Tests for `registerCustomBlocks` — runs a REAL GrapesJS editor instance
 * inside jsdom. No mocks. GrapesJS boots cleanly in jsdom (the canvas iframe
 * is only partially functional, but the Block manager / model API is fully
 * available, which is all these tests need).
 *
 * Custom block ids come from grapesBlocks.ts: `folyn-heading`, `folyn-paragraph`,
 * `folyn-button`, `folyn-list`, `folyn-quote` (category 文本), `folyn-card`,
 * `folyn-hero`, `folyn-divider`, `folyn-spacer` (category 布局).
 *
 * `grapesjs-blocks-basic` ships: column1, column2, column3, column3-7, text,
 * link, image, video, map.
 */

const FOLYN_BLOCK_IDS = [
  'folyn-heading',
  'folyn-paragraph',
  'folyn-button',
  'folyn-list',
  'folyn-quote',
  'folyn-card',
  'folyn-hero',
  'folyn-divider',
  'folyn-spacer',
] as const;

const PLUGINS_BASIC_IDS = [
  'column1',
  'column2',
  'column3',
  'column3-7',
  'text',
  'link',
  'image',
  'video',
  'map',
] as const;

describe('registerCustomBlocks', () => {
  let editor: Editor | null = null;

  afterEach(() => {
    if (editor) {
      try {
        editor.destroy();
      } catch {
        /* jsdom may emit warnings on destroy — non-fatal */
      }
    }
    editor = null;
  });

  function bootEditor(): Editor {
    const container = document.createElement('div');
    document.body.appendChild(container);
    return grapesjs.init({
      container,
      storageManager: false,
      panels: { defaults: [] },
      plugins: [blocksBasic],
      // Cast: grapesjs-blocks-basic types its options key as the plugin's
      // stringified name; TS rejects a function key. Same workaround as
      // grapesConfig.ts.
      pluginsOpts: { [blocksBasic as unknown as string]: { flexGrid: true } },
    });
  }

  it('#1 registers all 9 Folyn custom blocks', () => {
    editor = bootEditor();
    registerCustomBlocks(editor);

    const allIds = editor.Blocks.getAll().map((b: { id: string }) => b.id);
    for (const id of FOLYN_BLOCK_IDS) {
      expect(allIds).toContain(id);
    }
  });

  it('#2 each custom block has a non-empty label and content', () => {
    editor = bootEditor();
    registerCustomBlocks(editor);

    for (const id of FOLYN_BLOCK_IDS) {
      const block = editor.Blocks.get(id);
      expect(block).toBeDefined();
      const label = block.get('label') as string;
      const content = block.get('content') as string;
      expect(typeof label).toBe('string');
      expect(label.length).toBeGreaterThan(0);
      expect(typeof content).toBe('string');
      expect(content.length).toBeGreaterThan(0);
    }
  });

  it('#3 text blocks are categorized under "文本"', () => {
    editor = bootEditor();
    registerCustomBlocks(editor);

    const textIds = [
      'folyn-heading',
      'folyn-paragraph',
      'folyn-button',
      'folyn-list',
      'folyn-quote',
    ] as const;
    for (const id of textIds) {
      const block = editor.Blocks.get(id);
      const category = block.get('category') as
        | string
        | { id?: string; get?: (k: string) => string };
      // GrapesJS wraps categories as Backbone models with `id === '文本'`;
      // when a category already exists (e.g. from the basic plugin) the same
      // model is reused. Handle string | model-with-.id | model-with-.get().
      const catName =
        typeof category === 'string'
          ? category
          : category?.id ?? category?.get?.('name') ?? '';
      expect(catName).toBe('文本');
    }
  });

  it('#4 layout blocks are categorized under "布局"', () => {
    editor = bootEditor();
    registerCustomBlocks(editor);

    const layoutIds = [
      'folyn-card',
      'folyn-hero',
      'folyn-divider',
      'folyn-spacer',
    ] as const;
    for (const id of layoutIds) {
      const block = editor.Blocks.get(id);
      const category = block.get('category') as
        | string
        | { id?: string; get?: (k: string) => string };
      const catName =
        typeof category === 'string'
          ? category
          : category?.id ?? category?.get?.('name') ?? '';
      expect(catName).toBe('布局');
    }
  });

  it('#5 grapesjs-blocks-basic built-in blocks are also present (plugin integration works)', () => {
    editor = bootEditor();
    registerCustomBlocks(editor);

    const allIds = editor.Blocks.getAll().map((b: { id: string }) => b.id);
    for (const id of PLUGINS_BASIC_IDS) {
      expect(allIds).toContain(id);
    }
  });

  it('#6 editor.Blocks.get("folyn-heading") returns a block whose content is an HTML string', () => {
    editor = bootEditor();
    registerCustomBlocks(editor);

    const block = editor.Blocks.get('folyn-heading');
    expect(block).toBeDefined();
    const content = block.get('content') as string;
    expect(typeof content).toBe('string');
    expect(content.length).toBeGreaterThan(0);
    // The heading block's content is HTML — starts with `<`
    expect(content.trim().startsWith('<')).toBe(true);
    // And it's an <h2> per grapesBlocks.ts
    expect(content.toLowerCase()).toContain('<h2');
  });

  it('#7 registerCustomBlocks is idempotent — calling it twice does not duplicate or throw', () => {
    const ed = bootEditor();
    editor = ed;
    registerCustomBlocks(ed);
    const beforeCount = ed.Blocks.getAll().length;

    expect(() => registerCustomBlocks(ed)).not.toThrow();

    const afterCount = ed.Blocks.getAll().length;
    expect(afterCount).toBe(beforeCount);
  });
});
