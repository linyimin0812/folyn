/**
 * Build helpers for trusted extensions.
 *
 * A trusted extension is `import()`-ed into the host's page from a blob URL,
 * where bare imports do not resolve, and its components render in the host's
 * React tree. So it must not bundle its own React (or react-dom, react-i18next,
 * lucide-react): it uses the host's instances, which the host puts on
 * `window` before any extension loads. These helpers map those imports to the
 * host's instances — one place, instead of a shim file per extension.
 *
 * @example
 * // build.mjs
 * import esbuild from 'esbuild';
 * import { hostModules } from 'folyn-extension-sdk/build';
 *
 * await esbuild.build({
 *   entryPoints: ['src/index.tsx'],
 *   bundle: true,
 *   format: 'esm',
 *   jsx: 'automatic',
 *   alias: hostModules(),
 *   outfile: 'dist/index.js',
 * });
 */

import { fileURLToPath } from 'node:url';

const here = (file) => fileURLToPath(new URL(`./host-modules/${file}`, import.meta.url));

/**
 * esbuild `alias` map from each module the host shares to its host-instance
 * stand-in.
 *
 * `lucideIcons` lists the lucide-react icons the extension imports (lucide's
 * own ESM does not tree-shake correctly under esbuild, so the extension uses
 * the host's instance instead). The list is needed because an ES module's
 * exports are fixed when it is parsed. Omit it when the extension does not use
 * lucide-react; a missing name fails the build with "No matching export".
 *
 * @param {{ lucideIcons?: string[] }} [options]
 * @returns {Record<string, string>}
 */
export function hostModules(options = {}) {
  const alias = {
    react: here('react.js'),
    'react/jsx-runtime': here('react-jsx-runtime.js'),
    'react-dom': here('react-dom.js'),
    'react-dom/client': here('react-dom-client.js'),
    'react-i18next': here('react-i18next.js'),
  };
  if (options.lucideIcons) alias['lucide-react'] = lucideModule(options.lucideIcons);
  return alias;
}

/** A data-URL module re-exporting the named icons from the host's lucide-react. */
function lucideModule(icons) {
  for (const name of icons) {
    if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) throw new Error(`hostModules: not a lucide icon name: ${name}`);
  }
  const source = `const lucide = window.lucideReact;\nexport default lucide;\nexport const { ${icons.join(', ')} } = lucide;\n`;
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
}
