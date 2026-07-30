// Shared Graphviz render singleton.
//
// `@viz-js/viz` inlines its wasm as a `binaryDecode('…')` string literal inside
// `lib/backend.js` (see research/trusted-plugin-wasm-loading.md) — there is no
// separate `.wasm` asset, no `fetch`, no `locateFile`. Bundling `@viz-js/viz`
// into the plugin's self-contained ESM `main` carries the wasm along
// automatically; the main-webview CSP already grants `wasm-unsafe-eval`, so
// `WebAssembly.instantiate` runs on the inlined bytes.
//
// `instance()` is the public entry (`src/index.js`: `Module().then(m => new
// Viz(m))`). Importing the module does NOT instantiate the wasm — only calling
// `instance()` does. So a static top-level `import` is safe (the 1.17MB JS-with-
// inlined-wasm parses but the wasm only spins up on first render). Both the
// file-type Preview and the `:::graphviz` container share this one instance →
// wasm loads once per plugin lifetime.
import { instance, type Viz } from '@viz-js/viz';

let vizPromise: Promise<Viz> | null = null;

function getViz(): Promise<Viz> {
  if (!vizPromise) vizPromise = instance();
  return vizPromise;
}

/** Render a DOT source string to an SVG string. Throws on invalid DOT. */
export async function renderDot(source: string): Promise<{ svg: string }> {
  const viz = await getViz();
  const svg = viz.renderString(source, { format: 'svg', engine: 'dot' });
  return { svg };
}

/** Test-only: reset the cached instance so a fresh mock takes effect. */
export function __resetViz(): void {
  vizPromise = null;
}
