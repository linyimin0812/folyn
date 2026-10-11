import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import ts from '../../../node_modules/typescript/lib/typescript.js';
import { webkit, chromium } from '/tmp/webkit-bisect/node_modules/playwright/index.mjs';

const source = await fs.readFile(new URL('../../../apps/desktop/src/components/file-types/markdown/previewWordSelection.ts', import.meta.url), 'utf8');
const script = ts.transpileModule(source.replace(/export /g, ''), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const engine = process.argv[2] === 'chromium' ? chromium : webkit;
const browser = await engine.launch();
try {
  const page = await browser.newPage();
  await page.setContent(`<style>.md-preview{font:16px/1.6 system-ui;width:400px;zoom:1.25}</style>
    <div class="md-preview"><p>Read technical documentation.</p>
    <ul><li>Read <strong>tech</strong>nical documentation.\n<ul><li>Nested text</li></ul>\n</li></ul>
    <p>今天去公园看看风景。</p><p>one<br>two</p><pre><code>const value = 42;</code></pre>
    <table><tr><td>table words</td></tr></table><button>Control</button></div>`);
  await page.addScriptTag({ content: script + '\nwindow.removeSelection = installPreviewWordSelection(document.querySelector(".md-preview"));' });
  let checks = 0;
  for (const [selector, word] of [['p', 'technical'], ['li', 'technical'], ['p:nth-of-type(2)', '公园'], ['p:nth-of-type(2)', '风景'], ['code', 'value'], ['td', 'table']]) {
    const points = await page.evaluate(({ selector, word }) => {
      const el = document.querySelector(selector);
      const nodes = [];
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let text = '';
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        nodes.push({ node, start: text.length });
        text += node.textContent;
      }
      const start = text.indexOf(word);
      return Array.from({ length: word.length }, (_, i) => {
        const position = start + i;
        const { node, start: nodeStart } = nodes.find((n) => position >= n.start && position < n.start + n.node.length);
        const range = document.createRange();
        range.setStart(node, position - nodeStart);
        range.setEnd(node, position - nodeStart + 1);
        const rect = range.getBoundingClientRect();
        return { x: rect.x + rect.width * 0.75, y: rect.y + rect.height / 2 };
      });
    }, { selector, word });
    for (const point of points) {
      const resolved = await page.evaluate(({ x, y }) => previewWordRange(document.querySelector('.md-preview'), x, y)?.toString(), point);
      assert.equal(resolved, word, `${selector}: word at ${JSON.stringify(point)}`);
      await page.mouse.dblclick(point.x, point.y);
      await page.waitForTimeout(40);
      const selected = await page.evaluate(() => getSelection().toString());
      assert.equal(selected, word, `${selector}: double-click at ${JSON.stringify(point)}`);
      await page.mouse.click(700, 700);
      checks++;
    }
  }
  console.log(`${process.argv[2] || 'webkit'}: ${checks} character hit tests and double-click selections passed`);
} finally {
  await browser.close();
}
