/**
 * GrapesJS initialization config factory for the Mochi HTML editor.
 *
 * Mochi renders its own React UI shell (toolbar / panels / tabs) — GrapesJS
 * built-in panels are disabled, and the Block/Style/Selector/Layer/Trait
 * managers are mounted into React-managed container refs instead.
 *
 * Persistence is handled by Mochi's Zustand store (via the `onChange`
 * callback in `useGrapesEditor`), so GrapesJS's own storageManager is disabled.
 */

import type { Editor, RichTextEditorAction } from 'grapesjs';
import grapesjsBlocksBasic from 'grapesjs-blocks-basic';
import grapesjsPluginForms from 'grapesjs-plugin-forms';
import grapesjsTuiImageEditor from 'grapesjs-tui-image-editor';

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
 * Chinese labels for the blocks added by `grapesjs-plugin-forms`. The plugin
 * merges the return value of its `block(blockId)` option LAST, so returning
 * `{ label }` overrides the English default ('Form', 'Input', …). Category is
 * set globally via the `category` option below.
 */
const FORM_BLOCK_LABELS: Record<string, string> = {
  form: '表单',
  input: '输入框',
  textarea: '文本域',
  select: '下拉选择',
  button: '按钮',
  label: '字段标签',
  checkbox: '复选框',
  radio: '单选框',
};

/** TOAST UI Image Editor modal strings (set via plugin options, not i18n). */
const TUI_LABELS = {
  labelImageEditor: '图片编辑器',
  labelApply: '应用',
} as const;

/**
 * Chinese translations for GrapesJS built-in UI labels.
 *
 * GrapesJS resolves i18n keys via `editor.t(key)`: the I18n module first tries a
 * direct lookup of the full dotted string on the messages object, then falls
 * back to walking the nested object. We use flat dotted keys so each entry is a
 * single source of truth — no need to mirror GrapesJS's nested `en.js` shape.
 *
 * Key prefixes MUST match the actual `t(...)` call sites in the GrapesJS
 * source (verified against grapesjs@0.21.13):
 *   - `styleManager.properties.<css-prop>`   (property labels, NOT ...props.*)
 *   - `styleManager.options.<prop>.<opt>`    (select option labels)
 *   - `styleManager.fileButton` / `.empty`   (file picker button / empty hint)
 *   - `traitManager.traits.labels.<name>`    (trait labels, NOT traits.label.*)
 *   - `traitManager.traits.options.<name>.<val>` (trait select option labels)
 *   - `traitManager.label` / `.empty`        (panel header / empty hint)
 *   - `selectorManager.emptyState` / `.label` / `.selected` / `.states.*`
 *   - `assetManager.*`                       (image picker modal)
 *   - `domComponents.names.*`                (component/badge/layer names)
 *
 * Sector headers and device names are Chinese by construction (the `name`
 * fields in STYLE_SECTORS / deviceManager above), so they need no i18n entry.
 */
const ZH_MESSAGES: Record<string, string> = {
  // —— StyleManager property labels (styleManager.properties.<prop>) ——
  'styleManager.properties.font-family': '字体族',
  'styleManager.properties.font-size': '字号',
  'styleManager.properties.font-weight': '字重',
  'styleManager.properties.line-height': '行高',
  'styleManager.properties.letter-spacing': '字间距',
  'styleManager.properties.color': '颜色',
  'styleManager.properties.text-align': '对齐',
  'styleManager.properties.text-decoration': '文字装饰',
  'styleManager.properties.text-transform': '大小写',
  'styleManager.properties.background-color': '背景色',
  'styleManager.properties.background-image': '背景图',
  'styleManager.properties.background-repeat': '背景重复',
  'styleManager.properties.background-position': '背景位置',
  'styleManager.properties.background-size': '背景大小',
  'styleManager.properties.width': '宽度',
  'styleManager.properties.min-width': '最小宽度',
  'styleManager.properties.max-width': '最大宽度',
  'styleManager.properties.height': '高度',
  'styleManager.properties.min-height': '最小高度',
  'styleManager.properties.max-height': '最大高度',
  'styleManager.properties.margin': '外边距',
  'styleManager.properties.padding': '内边距',
  'styleManager.properties.border-radius': '圆角',
  'styleManager.properties.border': '边框',
  'styleManager.properties.box-shadow': '阴影',
  'styleManager.properties.display': '显示',
  'styleManager.properties.flex-direction': '主轴方向',
  'styleManager.properties.justify-content': '主轴对齐',
  'styleManager.properties.align-items': '交叉轴对齐',
  'styleManager.properties.flex-wrap': '换行',
  'styleManager.properties.gap': '间距',
  'styleManager.properties.position': '定位',
  'styleManager.properties.overflow': '溢出',
  'styleManager.properties.opacity': '透明度',
  // StyleManager composite/stack sub-property labels (margin/padding/border/box-shadow)
  'styleManager.properties.margin-top-sub': '上',
  'styleManager.properties.margin-right-sub': '右',
  'styleManager.properties.margin-bottom-sub': '下',
  'styleManager.properties.margin-left-sub': '左',
  'styleManager.properties.padding-top-sub': '上',
  'styleManager.properties.padding-right-sub': '右',
  'styleManager.properties.padding-bottom-sub': '下',
  'styleManager.properties.padding-left-sub': '左',
  'styleManager.properties.border-width-sub': '宽度',
  'styleManager.properties.border-style-sub': '样式',
  'styleManager.properties.border-color-sub': '颜色',
  'styleManager.properties.border-top-left-radius-sub': '左上',
  'styleManager.properties.border-top-right-radius-sub': '右上',
  'styleManager.properties.border-bottom-right-radius-sub': '右下',
  'styleManager.properties.border-bottom-left-radius-sub': '左下',
  'styleManager.properties.box-shadow-h': 'X',
  'styleManager.properties.box-shadow-v': 'Y',
  'styleManager.properties.box-shadow-blur': '模糊',
  'styleManager.properties.box-shadow-spread': '扩展',
  'styleManager.properties.box-shadow-color': '颜色',
  'styleManager.properties.box-shadow-type': '类型',
  // StyleManager generic strings
  'styleManager.empty': '请选择元素以编辑样式',
  'styleManager.fileButton': '图片',
  // —— TraitManager (traitManager.*) ——
  'traitManager.label': '组件属性',
  'traitManager.empty': '请选择元素以编辑属性',
  // Trait labels (traitManager.traits.labels.<name>)
  'traitManager.traits.labels.id': 'ID',
  'traitManager.traits.labels.name': '名称',
  'traitManager.traits.labels.placeholder': '占位文本',
  'traitManager.traits.labels.value': '值',
  'traitManager.traits.labels.type': '类型',
  'traitManager.traits.labels.href': '链接地址',
  'traitManager.traits.labels.src': '资源地址',
  'traitManager.traits.labels.alt': '替代文本',
  'traitManager.traits.labels.title': '标题',
  // `rel` is a technical HTML attribute name — kept verbatim by convention.
  'traitManager.traits.labels.rel': 'rel',
  'traitManager.traits.labels.target': '打开方式',
  // Form-component traits added by grapesjs-plugin-forms
  'traitManager.traits.labels.action': '提交地址',
  'traitManager.traits.labels.method': '方法',
  'traitManager.traits.labels.options': '选项',
  'traitManager.traits.labels.for': '关联字段',
  'traitManager.traits.labels.text': '文本',
  'traitManager.traits.labels.checked': '选中',
  'traitManager.traits.labels.required': '必填',
  // Trait select option labels (traitManager.traits.options.<name>.<value>)
  'traitManager.traits.options.target.false': '本窗口',
  'traitManager.traits.options.target._blank': '新窗口',
  // —— SelectorManager (selectorManager.*) ——
  'selectorManager.label': '选择器',
  'selectorManager.selected': '已选',
  'selectorManager.emptyState': '- 状态 -',
  'selectorManager.states.hover': '悬停',
  'selectorManager.states.active': '激活',
  'selectorManager.states.focus': '聚焦',
  'selectorManager.states.checked': '选中',
  // —— AssetManager (image picker modal — opened from background-image) ——
  'assetManager.addButton': '添加图片',
  'assetManager.modalTitle': '选择图片',
  'assetManager.inputPlh': 'http://图片地址',
  'assetManager.uploadTitle': '拖放文件至此或点击上传',
  // —— Component / layer / badge names (domComponents.names.*) ——
  // These show up in the Layer panel and the canvas selection badge.
  'domComponents.names.': '区块',
  'domComponents.names.wrapper': '主体',
  'domComponents.names.text': '文本',
  'domComponents.names.comment': '注释',
  'domComponents.names.image': '图片',
  'domComponents.names.video': '视频',
  'domComponents.names.label': '标签',
  'domComponents.names.link': '链接',
  'domComponents.names.map': '地图',
  'domComponents.names.table': '表格',
  'domComponents.names.thead': '表头',
  'domComponents.names.tbody': '表主体',
  'domComponents.names.tfoot': '表尾',
  'domComponents.names.row': '行',
  'domComponents.names.cell': '单元格',
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
    // Mochi owns persistence via Zustand store; GrapesJS must not try to
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

    plugins: [grapesjsBlocksBasic, grapesjsPluginForms, grapesjsTuiImageEditor],
    pluginsOpts: {
      // GrapesJS matches plugin options by plugin reference; at runtime the
      // function is coerced to a string key. The cast keeps TS happy because
      // `pluginsOpts` is typed as `Record<string, any>`.
      [grapesjsBlocksBasic as unknown as string]: {
        flexGrid: true,
        category: '基础',
      },
      [grapesjsPluginForms as unknown as string]: {
        // All form blocks share one Chinese category.
        category: '表单',
        // Override each block's English label with Chinese.
        block: (blockId: string) => {
          const label = FORM_BLOCK_LABELS[blockId];
          return label ? { label } : {};
        },
      },
      [grapesjsTuiImageEditor as unknown as string]: {
        // The plugin loads tui-image-editor from CDN at runtime (only when the
        // user opens the image editor), so the heavy fabric.js stack never
        // enters the Vite bundle. Modal strings are passed as plugin options.
        ...TUI_LABELS,
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
 * Inject the user's original inline <style> blocks directly into the canvas
 * iframe document head, bypassing GrapesJS's CssComposer.
 *
 * Why: GrapesJS's CSS parser drops `var()` from shorthand declarations (e.g.
 * `body { background: var(--bg); }` — the `background: var(--bg)` is silently
 * lost during setStyle parsing; only longhand-with-var like `color: var(--ink)`
 * survives). The browser's native CSS parser handles var() in shorthands
 * correctly, so injecting the original CSS verbatim gives correct rendering.
 *
 * Style Manager trade-off: CssComposer (populated separately by editor.setStyle)
 * holds the broken GrapesJS-parsed version, so Style Manager may show stale
 * values for rules that used var() in shorthands. Edits via Style Manager
 * update CssComposer, but `reconstructHtml` serializes from `parsed.styleBlocks`
 * (the original CSS), so Style Manager edits to existing rules do not persist.
 * Inline-style edits via the canvas still work and round-trip normally.
 * // ponytail: known limitation — Style Manager edits to class rules don't
 * // persist on save. Bypass CssComposer for serialization to preserve
 * // original CSS. Fix properly by merging editor.getCss() edits into
 * // parsed.styleBlocks when this becomes a real workflow blocker.
 */
export function injectInlineStyles(editor: Editor, styleBlocks: string[]): void {
  const canvasDoc = editor.Canvas?.getDocument?.();
  if (!canvasDoc || !styleBlocks.length) return;
  const style = canvasDoc.createElement('style');
  style.setAttribute('data-mochi', 'inline-styles');
  style.textContent = styleBlocks.join('\n\n');
  canvasDoc.head.appendChild(style);
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
  style.setAttribute('data-mochi', 'canvas-scrollbar-hide');
  style.textContent = `
    html, body {
      width: 100% !important;
      min-height: 100% !important;
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

/**
 * Chinese tooltips for the inline Rich Text Editor toolbar (the bold/italic/
 * underline/... button row that appears when editing text on the canvas).
 *
 * GrapesJS hardcodes these `title` attributes in its default RTE action
 * definitions (they are NOT routed through the i18n module), so we patch each
 * action's button element + `attributes.title` after the editor loads. Called
 * from `useGrapesEditor` on the `load` event.
 */
const RTE_TITLE_MAP: Record<string, string> = {
  bold: '加粗',
  italic: '斜体',
  underline: '下划线',
  strikethrough: '删除线',
  link: '链接',
  wrap: '换行',
};

export function localizeRteTitles(editor: Editor): void {
  const rte = editor.RichTextEditor;
  if (!rte || typeof rte.getAll !== 'function') return;
  const actions: RichTextEditorAction[] = rte.getAll();
  for (const action of actions) {
    const name = action?.name;
    if (!name) continue;
    const zh = RTE_TITLE_MAP[name];
    if (!zh) continue;
    if (!action.attributes) action.attributes = {};
    action.attributes.title = zh;
    action.btn?.setAttribute?.('title', zh);
  }
}
