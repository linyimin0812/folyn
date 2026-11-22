/**
 * A component bundled with `hostModules()` must render through the host's
 * React, not a copy, and keyed elements must keep their children. Runs in
 * Node (esbuild does not load under jsdom); `window` is a plain object here,
 * which is all the stand-ins read.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import * as reactI18next from 'react-i18next';
import { renderToStaticMarkup } from 'react-dom/server';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import esbuild from 'esbuild';
import { hostModules } from './index.js';

const host: Record<string, unknown> = {};
(globalThis as unknown as { window: unknown }).window = host;
let dir: string;

beforeAll(() => {
  host.React = React;
  host.ReactDOM = ReactDOM;
  host.reactI18next = reactI18next;
  host.lucideReact = { Bold: (p: { children?: unknown }) => React.createElement('strong', null, p.children as never) };
  dir = mkdtempSync(join(tmpdir(), 'host-modules-'));
});

afterAll(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
  rmSync(dir, { recursive: true, force: true });
});

/** Bundle `source` as an extension would and import the result. */
async function bundle(source: string, options?: Parameters<typeof hostModules>[0]) {
  const entry = join(dir, `entry-${Math.random().toString(36).slice(2)}.jsx`);
  writeFileSync(entry, source);
  const out = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    jsx: 'automatic',
    alias: hostModules(options),
    write: false,
    logLevel: 'silent',
  });
  const code = out.outputFiles[0].text;
  return { code, mod: await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`) };
}

describe('hostModules', () => {
  it('keeps the children of a keyed element', async () => {
    const { mod } = await bundle(`
      export const List = ({ items }) => <ul>{items.map((t) => <li key={t}><b>{t}</b></li>)}</ul>;
    `);
    expect(renderToStaticMarkup(React.createElement(mod.List, { items: ['a@x.com', 'b@x.com'] })))
      .toBe('<ul><li><b>a@x.com</b></li><li><b>b@x.com</b></li></ul>');
  });

  it('uses the host React instead of bundling one', async () => {
    const { code, mod } = await bundle(`
      import { useState, createElement } from 'react';
      export const Counter = () => { const [n] = useState(3); return <span>{n}</span>; };
      export const sameCreateElement = createElement;
    `);
    expect(mod.sameCreateElement).toBe(React.createElement);
    expect(renderToStaticMarkup(React.createElement(mod.Counter))).toBe('<span>3</span>');
    // React's own source never lands in the bundle.
    expect(code).not.toContain('react.production');
    expect(code.length).toBeLessThan(4000);
  });

  it('maps react-dom and react-i18next to the host instances', async () => {
    const { mod } = await bundle(`
      import { createPortal } from 'react-dom';
      import { createRoot } from 'react-dom/client';
      import { useTranslation } from 'react-i18next';
      export { createPortal, createRoot, useTranslation };
    `);
    expect(mod.createPortal).toBe(ReactDOM.createPortal);
    expect(mod.createRoot).toBe((ReactDOM as unknown as { createRoot: unknown }).createRoot);
    expect(mod.useTranslation).toBe(reactI18next.useTranslation);
  });

  it('re-exports the listed lucide icons from the host', async () => {
    const { mod } = await bundle(`import { Bold } from 'lucide-react'; export { Bold };`, { lucideIcons: ['Bold'] });
    expect(mod.Bold).toBe((host.lucideReact as { Bold: unknown }).Bold);
  });

  it('fails the build for an icon that was not listed', async () => {
    await expect(bundle(`import { Italic } from 'lucide-react'; export { Italic };`, { lucideIcons: ['Bold'] }))
      .rejects.toThrow(/Italic/);
  });

  it('rejects a lucide name that is not an identifier', () => {
    expect(() => hostModules({ lucideIcons: ['Bold, evil'] })).toThrow(/not a lucide icon name/);
  });
});
