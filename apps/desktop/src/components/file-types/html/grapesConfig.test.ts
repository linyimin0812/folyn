// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createGrapesConfig } from './grapesConfig';
import grapesjsBlocksBasic from 'grapesjs-blocks-basic';

/**
 * Tests for the GrapesJS config factory.
 *
 * `createGrapesConfig` is a pure factory — it does not boot a GrapesJS runtime,
 * it only returns the config object handed to `grapesjs.init()`. These tests
 * assert the structural contract: which keys are present, what their values
 * are, and (critically) which keys are ABSENT — e.g. `blockManager` was
 * removed when the React shell stopped rendering a left sidebar (see comment
 * in grapesConfig.ts).
 *
 * No mocks, no GrapesJS runtime. Just the returned plain object.
 */

function makeOpts() {
  const container = document.createElement('div');
  const stylesContainer = document.createElement('div');
  const selectorsContainer = document.createElement('div');
  const layersContainer = document.createElement('div');
  const traitsContainer = document.createElement('div');
  return {
    container,
    stylesContainer,
    selectorsContainer,
    layersContainer,
    traitsContainer,
  };
}

describe('createGrapesConfig', () => {
  it('#1 returns an object with container pointing at opts.container', () => {
    const opts = makeOpts();
    const cfg = createGrapesConfig(opts);
    expect(cfg.container).toBe(opts.container);
  });

  it('#2 width is "100%" (fills the React shell center column, no blank strip)', () => {
    const cfg = createGrapesConfig(makeOpts());
    expect(cfg.width).toBe('100%');
  });

  it('#3 height is "100%"', () => {
    const cfg = createGrapesConfig(makeOpts());
    expect(cfg.height).toBe('100%');
  });

  it('#4 fromElement is false (we feed content via setComponents/setStyle)', () => {
    const cfg = createGrapesConfig(makeOpts());
    expect(cfg.fromElement).toBe(false);
  });

  it('#5 storageManager is false (Quill Zustand store owns persistence)', () => {
    const cfg = createGrapesConfig(makeOpts());
    expect(cfg.storageManager).toBe(false);
  });

  it('#6 panels.defaults is [] (built-in panels disabled, React renders chrome)', () => {
    const cfg = createGrapesConfig(makeOpts());
    expect(cfg.panels).toEqual({ defaults: [] });
  });

  it('#7 styleManager appendTo + sectors are configured', () => {
    const opts = makeOpts();
    const cfg = createGrapesConfig(opts);
    expect(cfg.styleManager).toBeDefined();
    expect((cfg.styleManager as { appendTo: HTMLElement }).appendTo).toBe(
      opts.stylesContainer,
    );
    const sectors = (cfg.styleManager as { sectors: unknown[] }).sectors;
    expect(Array.isArray(sectors)).toBe(true);
    expect(sectors.length).toBeGreaterThan(0);
  });

  it('#8 styleManager.sectors contains the 6 required sector names', () => {
    const cfg = createGrapesConfig(makeOpts());
    const sectors = (cfg.styleManager as { sectors: { name: string }[] }).sectors;
    const names = sectors.map((s) => s.name);
    expect(names).toEqual(
      expect.arrayContaining([
        '字体',
        '背景',
        '尺寸',
        '间距',
        '边框',
        '布局',
      ]),
    );
    expect(names).toHaveLength(6);
  });

  it('#9 selectorManager.appendTo is opts.selectorsContainer', () => {
    const opts = makeOpts();
    const cfg = createGrapesConfig(opts);
    expect(cfg.selectorManager).toBeDefined();
    expect((cfg.selectorManager as { appendTo: HTMLElement }).appendTo).toBe(
      opts.selectorsContainer,
    );
  });

  it('#10 layerManager.appendTo is opts.layersContainer', () => {
    const opts = makeOpts();
    const cfg = createGrapesConfig(opts);
    expect(cfg.layerManager).toBeDefined();
    expect((cfg.layerManager as { appendTo: HTMLElement }).appendTo).toBe(
      opts.layersContainer,
    );
  });

  it('#11 traitManager.appendTo is opts.traitsContainer', () => {
    const opts = makeOpts();
    const cfg = createGrapesConfig(opts);
    expect(cfg.traitManager).toBeDefined();
    expect((cfg.traitManager as { appendTo: HTMLElement }).appendTo).toBe(
      opts.traitsContainer,
    );
  });

  it('#12 deviceManager.devices has 3 entries: 桌面, 平板, 手机', () => {
    const cfg = createGrapesConfig(makeOpts());
    const devices = (cfg.deviceManager as { devices: { name: string }[] }).devices;
    expect(devices).toHaveLength(3);
    const names = devices.map((d) => d.name);
    expect(names).toEqual(['桌面', '平板', '手机']);
  });

  it('#13 plugins array includes the grapesjs-blocks-basic plugin reference', () => {
    const cfg = createGrapesConfig(makeOpts());
    const plugins = cfg.plugins as unknown[];
    expect(Array.isArray(plugins)).toBe(true);
    expect(plugins).toContain(grapesjsBlocksBasic);
  });

  it('#14 pluginsOpts for blocks-basic has flexGrid:true and category:"基础"', () => {
    const cfg = createGrapesConfig(makeOpts());
    const opts = cfg.pluginsOpts as Record<string, { flexGrid: boolean; category: string }>;
    // Plugin options are keyed by the plugin reference coerced to string.
    const key = String(grapesjsBlocksBasic as unknown);
    const found = opts[key];
    expect(found).toBeDefined();
    expect(found.flexGrid).toBe(true);
    expect(found.category).toBe('基础');
  });

  it('#15 blockManager config key is ABSENT (removed when sidebar was deleted)', () => {
    const cfg = createGrapesConfig(makeOpts());
    // Per the code comment in grapesConfig.ts, blockManager is intentionally
    // not configured — React shell renders no block-library sidebar.
    expect(Object.prototype.hasOwnProperty.call(cfg, 'blockManager')).toBe(false);
    expect(cfg.blockManager).toBeUndefined();
  });

  it('#16 canvas.styles includes the Google Fonts Inter stylesheet URL', () => {
    const cfg = createGrapesConfig(makeOpts());
    const canvas = cfg.canvas as { styles: string[] };
    expect(canvas).toBeDefined();
    expect(Array.isArray(canvas.styles)).toBe(true);
    const fontsUrl = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap';
    expect(canvas.styles).toContain(fontsUrl);
  });
});
