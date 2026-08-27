/**
 * Code-highlight theme registry — uses highlight.js's official CSS themes.
 *
 * Each theme is the raw CSS shipped by highlight.js
 * (node_modules/highlight.js/styles/*.css), imported via Vite's `?raw`.
 * On selection, the CSS is injected into a `<style>` element scoped to
 * `[data-code-theme]`. The `pre code.hljs` / `code.hljs` layout rules
 * (padding, overflow) are stripped so existing `.md-preview pre` styles
 * remain authoritative; only `.hljs-*` color rules pass through.
 *
 * Default `'auto'` emits no CSS — uses the base `.hljs-*` rules in index.css.
 *
 * To add a theme: import its CSS `?raw` and add an entry to {@link THEMES}.
 */

export type CodeThemeId =
  | 'auto'
  | 'github'
  | 'atom-one-light'
  | 'stackoverflow-light'
  | 'xcode'
  | 'paraiso-light'
  | 'rose-pine-dawn'
  | 'color-brewer'
  | 'github-dark'
  | 'github-dark-dimmed'
  | 'atom-one-dark'
  | 'atom-one-dark-reasonable'
  | 'monokai'
  | 'monokai-sublime'
  | 'nord'
  | 'tokyo-night-dark'
  | 'rose-pine'
  | 'rose-pine-moon'
  | 'night-owl'
  | 'a11y-dark'
  | 'stackoverflow-dark'
  | 'androidstudio'
  | 'obsidian'
  | 'vs2015'
  | 'kimbie-dark'
  | 'panda-syntax-dark'
  | 'shades-of-purple'
  | 'srcery'
  | 'gradient-dark'
  | 'hybrid'
  | 'ir-black'
  | 'tomorrow-night-blue'
  | 'tomorrow-night-bright';

// highlight.js official CSS themes (Vite ?raw imports the file as a string).
import githubCss from 'highlight.js/styles/github.css?raw';
import atomOneLightCss from 'highlight.js/styles/atom-one-light.css?raw';
import stackoverflowLightCss from 'highlight.js/styles/stackoverflow-light.css?raw';
import xcodeCss from 'highlight.js/styles/xcode.css?raw';
import paraisoLightCss from 'highlight.js/styles/paraiso-light.css?raw';
import rosePineDawnCss from 'highlight.js/styles/rose-pine-dawn.css?raw';
import colorBrewerCss from 'highlight.js/styles/color-brewer.css?raw';
import githubDarkCss from 'highlight.js/styles/github-dark.css?raw';
import githubDarkDimmedCss from 'highlight.js/styles/github-dark-dimmed.css?raw';
import atomOneDarkCss from 'highlight.js/styles/atom-one-dark.css?raw';
import atomOneDarkReasonableCss from 'highlight.js/styles/atom-one-dark-reasonable.css?raw';
import monokaiCss from 'highlight.js/styles/monokai.css?raw';
import monokaiSublimeCss from 'highlight.js/styles/monokai-sublime.css?raw';
import nordCss from 'highlight.js/styles/nord.css?raw';
import tokyoNightDarkCss from 'highlight.js/styles/tokyo-night-dark.css?raw';
import rosePineCss from 'highlight.js/styles/rose-pine.css?raw';
import rosePineMoonCss from 'highlight.js/styles/rose-pine-moon.css?raw';
import nightOwlCss from 'highlight.js/styles/night-owl.css?raw';
import a11yDarkCss from 'highlight.js/styles/a11y-dark.css?raw';
import stackoverflowDarkCss from 'highlight.js/styles/stackoverflow-dark.css?raw';
import androidstudioCss from 'highlight.js/styles/androidstudio.css?raw';
import obsidianCss from 'highlight.js/styles/obsidian.css?raw';
import vs2015Css from 'highlight.js/styles/vs2015.css?raw';
import kimbieDarkCss from 'highlight.js/styles/kimbie-dark.css?raw';
import pandaSyntaxDarkCss from 'highlight.js/styles/panda-syntax-dark.css?raw';
import shadesOfPurpleCss from 'highlight.js/styles/shades-of-purple.css?raw';
import srceryCss from 'highlight.js/styles/srcery.css?raw';
import gradientDarkCss from 'highlight.js/styles/gradient-dark.css?raw';
import hybridCss from 'highlight.js/styles/hybrid.css?raw';
import irBlackCss from 'highlight.js/styles/ir-black.css?raw';
import tomorrowNightBlueCss from 'highlight.js/styles/tomorrow-night-blue.css?raw';
import tomorrowNightBrightCss from 'highlight.js/styles/tomorrow-night-bright.css?raw';

export interface ThemeDef {
  id: CodeThemeId;
  /** i18n key suffix under `settings:appearance.codeTheme.<id>` */
  labelKey: string;
  /** Raw highlight.js CSS. `null` for 'auto' (uses base rules). */
  css: string | null;
}

export const THEMES: ThemeDef[] = [
  { id: 'auto', labelKey: 'auto', css: null },
  { id: 'github', labelKey: 'github', css: githubCss },
  { id: 'atom-one-light', labelKey: 'atom-one-light', css: atomOneLightCss },
  { id: 'stackoverflow-light', labelKey: 'stackoverflow-light', css: stackoverflowLightCss },
  { id: 'xcode', labelKey: 'xcode', css: xcodeCss },
  { id: 'paraiso-light', labelKey: 'paraiso-light', css: paraisoLightCss },
  { id: 'rose-pine-dawn', labelKey: 'rose-pine-dawn', css: rosePineDawnCss },
  { id: 'color-brewer', labelKey: 'color-brewer', css: colorBrewerCss },
  { id: 'github-dark', labelKey: 'github-dark', css: githubDarkCss },
  { id: 'github-dark-dimmed', labelKey: 'github-dark-dimmed', css: githubDarkDimmedCss },
  { id: 'atom-one-dark', labelKey: 'atom-one-dark', css: atomOneDarkCss },
  { id: 'atom-one-dark-reasonable', labelKey: 'atom-one-dark-reasonable', css: atomOneDarkReasonableCss },
  { id: 'monokai', labelKey: 'monokai', css: monokaiCss },
  { id: 'monokai-sublime', labelKey: 'monokai-sublime', css: monokaiSublimeCss },
  { id: 'nord', labelKey: 'nord', css: nordCss },
  { id: 'tokyo-night-dark', labelKey: 'tokyo-night-dark', css: tokyoNightDarkCss },
  { id: 'rose-pine', labelKey: 'rose-pine', css: rosePineCss },
  { id: 'rose-pine-moon', labelKey: 'rose-pine-moon', css: rosePineMoonCss },
  { id: 'night-owl', labelKey: 'night-owl', css: nightOwlCss },
  { id: 'a11y-dark', labelKey: 'a11y-dark', css: a11yDarkCss },
  { id: 'stackoverflow-dark', labelKey: 'stackoverflow-dark', css: stackoverflowDarkCss },
  { id: 'androidstudio', labelKey: 'androidstudio', css: androidstudioCss },
  { id: 'obsidian', labelKey: 'obsidian', css: obsidianCss },
  { id: 'vs2015', labelKey: 'vs2015', css: vs2015Css },
  { id: 'kimbie-dark', labelKey: 'kimbie-dark', css: kimbieDarkCss },
  { id: 'panda-syntax-dark', labelKey: 'panda-syntax-dark', css: pandaSyntaxDarkCss },
  { id: 'shades-of-purple', labelKey: 'shades-of-purple', css: shadesOfPurpleCss },
  { id: 'srcery', labelKey: 'srcery', css: srceryCss },
  { id: 'gradient-dark', labelKey: 'gradient-dark', css: gradientDarkCss },
  { id: 'hybrid', labelKey: 'hybrid', css: hybridCss },
  { id: 'ir-black', labelKey: 'ir-black', css: irBlackCss },
  { id: 'tomorrow-night-blue', labelKey: 'tomorrow-night-blue', css: tomorrowNightBlueCss },
  { id: 'tomorrow-night-bright', labelKey: 'tomorrow-night-bright', css: tomorrowNightBrightCss },
];

const THEME_MAP = new Map<CodeThemeId, ThemeDef>(THEMES.map((t) => [t.id, t]));

export function getThemeDef(id: CodeThemeId): ThemeDef {
  return THEME_MAP.get(id) ?? THEME_MAP.get('auto')!;
}

/**
 * Strip the `pre code.hljs` and `code.hljs` layout rules from a highlight.js
 * theme CSS so only color rules remain. These two rules set `display:block`,
 * `overflow-x:auto`, and `padding` which conflict with the app's `.md-preview pre`
 * and `CodeFileViewer` styles. Color rules (`.hljs`, `.hljs-*`) are kept as-is.
 */
function stripLayoutRules(css: string): string {
  return css
    // Strip /* comments */ first so the layout-rule regex and the scoping
    // regex don't match comment text.
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // Remove the `pre code.hljs { display; overflow; padding }` and
    // `code.hljs { padding }` layout rules — they conflict with the app's
    // .md-preview pre and CodeFileViewer styles.
    .replace(/pre code\.hljs\s*\{[^}]*\}/g, '')
    .replace(/^[\s]*code\.hljs\s*\{[^}]*\}/gm, '');
}

/**
 * Return the theme CSS, scoped so it only applies when `[data-code-theme]`
 * is set on `<html>`. Returns '' for 'auto'.
 *
 * The raw hljs CSS uses bare `.hljs-*` selectors (specificity 0,1,0). The
 * app's base rules in index.css are more specific — e.g. `.code-block-inner
 * pre code` (0,3,0) sets `background: var(--surf); color: var(--t1)` which
 * would beat a scoped `[data-code-theme] .hljs` (0,2,0). To guarantee the
 * theme wins without rewriting every base rule, the scoped CSS adds
 * `!important` to color/background declarations. This is safe because the
 * rules are scoped to `[data-code-theme="<id>"]` — they only apply while
 * that specific theme is active, and 'auto' emits no CSS at all.
 */
export function themeCss(id: CodeThemeId): string {
  const def = getThemeDef(id);
  if (!def.css) return '';
  const sel = `[data-code-theme="${id}"]`;
  const cleaned = stripLayoutRules(def.css);
  // Scope every rule: prefix each selector with the scope, and add
  // !important to color/background/font-style/font-weight values so the
  // theme beats the higher-specificity base rules in index.css.
  return cleaned.replace(
    /([^{}]+)\{([^}]*)\}/g,
    (_full, selectors: string, body: string) => {
      const prefixed = selectors
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => `${sel} ${s}`)
        .join(', ');
      // Add !important to visual properties. Match background-color before
      // background so the longer keyword wins; the negative lookahead
      // (?!\s*!important) avoids doubling up if a value already has it.
      const props = /(background-color|background|color|font-style|font-weight|text-decoration)\s*:[^;}]+/g;
      const importantBody = body.replace(props, (m) => /!important/.test(m) ? m : m + ' !important');
      return `${prefixed} { ${importantBody} }`;
    },
  );
}

/** Map hljs token classes to CodeMirror `--cm-*` variables. CodeMirror doesn't
 *  use `.hljs-*` classes (it styles via lezer tags → CSS vars in
 *  highlightStyle.ts), so the hljs CSS theme alone doesn't affect the editor.
 *  This extracts key token colors from the raw hljs CSS and emits `--cm-*`
 *  overrides scoped to `:root[data-code-theme]` so the editor tracks the
 *  selected theme. */
const HLJS_TO_CM: Array<{ hljs: string[]; cm: string }> = [
  { hljs: ['.hljs-comment'], cm: '--cm-comment' },
  { hljs: ['.hljs-keyword', '.hljs-selector-tag'], cm: '--cm-keyword' },
  { hljs: ['.hljs-number', '.hljs-literal'], cm: '--cm-number' },
  { hljs: ['.hljs-string', '.hljs-addition'], cm: '--cm-string' },
  { hljs: ['.hljs-regexp'], cm: '--cm-regexp' },
  { hljs: ['.hljs-attr', '.hljs-attribute', '.hljs-variable'], cm: '--cm-var-local' },
  { hljs: ['.hljs-type', '.hljs-built_in'], cm: '--cm-type' },
  { hljs: ['.hljs-meta'], cm: '--cm-meta' },
  { hljs: ['.hljs-title', '.hljs-section'], cm: '--cm-var-def' },
  { hljs: ['.hljs-symbol', '.hljs-bullet'], cm: '--cm-atom' },
  { hljs: ['.hljs-class .hljs-title'], cm: '--cm-class' },
  { hljs: ['.hljs-variable'], cm: '--cm-prop' },
];

/** Extract a color value for a selector from raw hljs CSS text.
 *  hljs themes group selectors (`.hljs-tag, .hljs-keyword, ... { color }`),
 *  so we match any rule whose selector list contains the target selector. */
function extractColor(css: string, selectors: string[]): string | null {
  for (const sel of selectors) {
    const escaped = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Match a rule block `...selectors... { ... color: VALUE ... }` where
    // the selector list contains our target selector. [^{}]* avoids
    // crossing into adjacent rules.
    const re = new RegExp('([^{}]*' + escaped + '[^{}]*)\\{[^}]*color\\s*:\\s*([^;}]+)');
    const m = css.match(re);
    if (m) {
      const v = m[2].trim().replace(/!important/, '').trim();
      if (v && !v.startsWith('var(')) return v;
    }
  }
  return null;
}

/** Generate `--cm-*` variable overrides for CodeMirror from an hljs theme. */
export function themeCmVars(id: CodeThemeId): string {
  const def = getThemeDef(id);
  if (!def.css) return '';
  const raw = def.css.replace(/\/\*[\s\S]*?\*\//g, '');
  const decls: string[] = [];
  for (const { hljs, cm } of HLJS_TO_CM) {
    const color = extractColor(raw, hljs);
    if (color) decls.push(`${cm}: ${color};`);
  }
  if (decls.length === 0) return '';
  return `:root[data-code-theme="${id}"] { ${decls.join(' ')} }`;
}
