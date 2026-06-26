/**
 * GrapesJS initialization config factory for the Quill HTML editor.
 *
 * Quill renders its own React UI shell (toolbar / panels / tabs) — GrapesJS
 * built-in panels are disabled, and the Block/Style/Selector/Layer/Trait
 * managers are mounted into React-managed container refs instead.
 *
 * Persistence is handled by Quill's Zustand store (via the `onChange`
 * callback in `useGrapesEditor`), so GrapesJS's own storageManager is disabled.
 */

import type { Editor } from 'grapesjs';
import grapesjsBlocksBasic from 'grapesjs-blocks-basic';

export interface GrapesInitOptions {
  /** Canvas container — GrapesJS owns the iframe inside this node. */
  container: HTMLElement;
  /** Mount point for the StyleManager panel. */
  stylesContainer: HTMLElement;
  /** Mount point for the SelectorManager panel. */
  selectorsContainer: HTMLElement;
  /** Mount point for the LayerManager panel. */
  layersContainer: HTMLElement;
  /** Mount point for the TraitManager panel. */
  traitsContainer: HTMLElement;
}

/**
 * Style Manager sectors — 6 sectors covering the full CSS surface area prd
 * §4.3 specifies (typography, background, dimensions, spacing, border, layout).
 */
const STYLE_SECTORS = [
  {
    name: '字体',
    open: false,
    buildProps: [
      'font-family',
      'font-size',
      'font-weight',
      'line-height',
      'letter-spacing',
      'color',
      'text-align',
      'text-decoration',
      'text-transform',
    ],
  },
  {
    name: '背景',
    open: false,
    buildProps: [
      'background-color',
      'background-image',
      'background-repeat',
      'background-position',
      'background-size',
    ],
  },
  {
    name: '尺寸',
    open: false,
    buildProps: [
      'width',
      'min-width',
      'max-width',
      'height',
      'min-height',
      'max-height',
    ],
  },
  {
    name: '间距',
    open: false,
    buildProps: ['margin', 'padding'],
  },
  {
    name: '边框',
    open: false,
    buildProps: ['border-radius', 'border', 'box-shadow'],
  },
  {
    name: '布局',
    open: false,
    buildProps: [
      'display',
      'flex-direction',
      'justify-content',
      'align-items',
      'flex-wrap',
      'gap',
      'position',
      'overflow',
      'opacity',
    ],
  },
];

/** External stylesheet URLs injected into the canvas iframe on load. */
const CANVAS_STYLES = [
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
];

/**
 * Chinese translations for GrapesJS built-in UI labels. Sector headers and
 * device names are set in Chinese directly via the `name` fields above; this
 * i18n map covers the property labels, trait labels, and other strings that
 * GrapesJS renders from its default `en` locale.
 */
const ZH_MESSAGES: Record<string, string> = {
  // StyleManager property labels
  'styleManager.props.font-family': '字体族',
  'styleManager.props.font-size': '字号',
  'styleManager.props.font-weight': '字重',
  'styleManager.props.line-height': '行高',
  'styleManager.props.letter-spacing': '字间距',
  'styleManager.props.color': '颜色',
  'styleManager.props.text-align': '对齐',
  'styleManager.props.text-decoration': '文字装饰',
  'styleManager.props.text-transform': '大小写',
  'styleManager.props.background-color': '背景色',
  'styleManager.props.background-image': '背景图',
  'styleManager.props.background-repeat': '背景重复',
  'styleManager.props.background-position': '背景位置',
  'styleManager.props.background-size': '背景大小',
  'styleManager.props.width': '宽度',
  'styleManager.props.min-width': '最小宽度',
  'styleManager.props.max-width': '最大宽度',
  'styleManager.props.height': '高度',
  'styleManager.props.min-height': '最小高度',
  'styleManager.props.max-height': '最大高度',
  'styleManager.props.margin': '外边距',
  'styleManager.props.padding': '内边距',
  'styleManager.props.border-radius': '圆角',
  'styleManager.props.border': '边框',
  'styleManager.props.box-shadow': '阴影',
  'styleManager.props.display': '显示',
  'styleManager.props.flex-direction': '主轴方向',
  'styleManager.props.justify-content': '主轴对齐',
  'styleManager.props.align-items': '交叉轴对齐',
  'styleManager.props.flex-wrap': '换行',
  'styleManager.props.gap': '间距',
  'styleManager.props.position': '定位',
  'styleManager.props.overflow': '溢出',
  'styleManager.props.opacity': '透明度',
  // Common placeholders / buttons
  'styleManager.empty': '请选择元素以编辑样式',
  'styleManager.button-add': '添加',
  'placeholder.class-name': '类名',
  'placeholder.id-name': 'ID',
  'placeholder.tag-name': '标签',
  // Trait labels
  'traits.label.id': 'ID',
  'traits.label.name': '名称',
  'traits.label.placeholder': '占位文本',
  'traits.label.value': '值',
  'traits.label.type': '类型',
  'traits.label.href': '链接地址',
  'traits.label.src': '资源地址',
  'traits.label.alt': '替代文本',
  'traits.label.title': '标题',
  'traits.label.rel': 'rel',
  'traits.label.target': '打开方式',
  'traitManager.empty': '请选择元素以编辑属性',
  // Layers
  'layers.label': '图层',
  // Selector / classes
  'selectorManager.label': '选择器',
  'selectorManager.empty': '选择元素以查看类与状态',
  'selectorManager.state': '状态',
  'selectorManager.states.hover': '悬停',
  'selectorManager.states.active': '激活',
  'selectorManager.states.focus': '聚焦',
  'selectorManager.states.checked': '选中',
  'selectorManager.add-new': '添加新类',
  // Devices
  'deviceManager.desktop': '桌面',
  'deviceManager.tablet': '平板',
  'deviceManager.mobile-portrait': '手机',
};

/**
 * Build the config object handed to `grapesjs.init()`.
 */
export function createGrapesConfig(opts: GrapesInitOptions): Record<string, unknown> {
  return {
    container: opts.container,
    height: '100%',
    // Fill the React shell's center column width. `width: 'auto'` sizes the
    // canvas iframe to content width, leaving a blank strip on the right; we
    // must take the full container width so no empty gap appears.
    width: '100%',
    fromElement: false,
    // Quill owns persistence via Zustand store; GrapesJS must not try to
    // autosave to localStorage or remote backends.
    storageManager: false,
    // Disable built-in panels — the React shell renders its own toolbar.
    panels: { defaults: [] },

    // i18n — render the entire GrapesJS UI in Chinese.
    i18n: {
      locale: 'zh',
      detect: false,
      messages: { zh: ZH_MESSAGES },
    },

    // BlockManager is intentionally left unmounted: the React shell no longer
    // renders a block-library sidebar. GrapesJS falls back to its default
    // hidden block container, and `registerCustomBlocks` still works (it
    // only mutates the manager's registry, not the DOM). Removing the
    // `blockManager` config key entirely is safe.
    styleManager: { appendTo: opts.stylesContainer, sectors: STYLE_SECTORS },
    selectorManager: { appendTo: opts.selectorsContainer },
    layerManager: { appendTo: opts.layersContainer },
    traitManager: { appendTo: opts.traitsContainer },

    deviceManager: {
      devices: [
        { name: '桌面', width: '' },
        { name: '平板', width: '768px', widthMedia: '992px' },
        { name: '手机', width: '375px', widthMedia: '480px' },
      ],
    },

    canvas: {
      styles: CANVAS_STYLES,
    },

    plugins: [grapesjsBlocksBasic],
    pluginsOpts: {
      // GrapesJS matches plugin options by plugin reference; at runtime the
      // function is coerced to a string key. The cast keeps TS happy because
      // `pluginsOpts` is typed as `Record<string, any>`.
      [grapesjsBlocksBasic as unknown as string]: {
        flexGrid: true,
        category: '基础',
      },
    },
  };
}

/**
 * Inject external <link> stylesheets from the parsed <head> into the canvas
 * iframe document. Called once on `editor.on('load', ...)` (prd §6.2).
 */
export function injectExternalLinks(editor: Editor, headContent: string): void {
  const canvasDoc = editor.Canvas?.getDocument?.();
  if (!canvasDoc || !headContent) return;
  // Match <link rel="stylesheet" href="..."> (case-insensitive, tolerant attrs)
  const linkRegex = /<link\b[^>]*>/gi;
  const matches = headContent.match(linkRegex) || [];
  for (const tag of matches) {
    const tmp = document.createElement('div');
    tmp.innerHTML = tag;
    const link = tmp.firstChild as HTMLLinkElement | null;
    if (!link || link.tagName.toLowerCase() !== 'link') continue;
    const cloned = canvasDoc.importNode(link, true);
    canvasDoc.head.appendChild(cloned);
  }
}

/**
 * Hide scrollbars inside the canvas iframe document. GrapesJS renders the
 * edited page inside a sandboxed iframe; parent-page CSS cannot reach into
 * it, so a <style> tag is injected into the iframe's <head> to suppress the
 * html/body scrollbar gutter while keeping wheel/trackpad scrolling working.
 */
export function injectCanvasScrollbarHide(editor: Editor): void {
  const canvasDoc = editor.Canvas?.getDocument?.();
  if (!canvasDoc) return;
  const style = canvasDoc.createElement('style');
  style.setAttribute('data-quill', 'canvas-scrollbar-hide');
  style.textContent = `
    html, body {
      width: 100% !important;
      min-height: 100% !important;
      margin: 0 !important;
      padding: 0 !important;
      scrollbar-width: none !important;
      -ms-overflow-style: none !important;
    }
    html::-webkit-scrollbar,
    body::-webkit-scrollbar,
    body *::-webkit-scrollbar { display: none !important; }
    body * {
      scrollbar-width: none !important;
      -ms-overflow-style: none !important;
    }
  `;
  canvasDoc.head.appendChild(style);
}
