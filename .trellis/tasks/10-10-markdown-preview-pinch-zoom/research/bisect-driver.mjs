// Playwright driver for the double-click selection bisect.
// Usage: node driver.mjs <webkit|chromium|firefox> <abs-path-to-html> <out.json>
import { webkit, chromium } from '/tmp/webkit-bisect/node_modules/playwright/index.mjs';
import fs from 'node:fs';

const BROWSER = process.argv[2] || 'webkit';
const FILE = process.argv[3];
const OUT = process.argv[4];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Map a selection boundary point to { paraId, offset } by walking text nodes.
const selInfoScript = (paraId) => {
  return `(() => {
    const s = window.getSelection();
    if (!s || s.rangeCount === 0 || s.isCollapsed) return { empty: true, text: s ? s.toString() : '' };
    const text = s.toString();
    // locate boundaries inside the given paragraph
    const p = document.getElementById(${JSON.stringify(paraId)});
    function offsetIn(node, off) {
      if (!node) return null;
      let n = node;
      // ascend to a node inside p
      while (n && n.parentNode !== p && n !== p) n = n.parentNode;
      if (!n || n === p) return null;
      let acc = 0;
      for (const child of p.childNodes) {
        if (child === n || child.contains(n)) {
          if (child.nodeType === 3) return acc + (child === n ? off : off);
          return null; // nested element, give up precise offset
        }
        acc += child.textContent.length;
      }
      return null;
    }
    const anchorNode = s.anchorNode, focusNode = s.focusNode;
    const anchorIn = p.contains(anchorNode);
    const focusIn = p.contains(focusNode);
    const startOff = offsetIn(anchorNode, s.anchorOffset);
    const endOff = offsetIn(focusNode, s.focusOffset);
    return {
      empty: false,
      text,
      len: text.length,
      paraLen: p.textContent.length,
      anchorIn, focusIn,
      startOff, endOff,
      anchorParent: anchorNode && anchorNode.parentNode ? anchorNode.parentNode.tagName : '?',
      focusParent: focusNode && focusNode.parentNode ? focusNode.parentNode.tagName : '?',
      snippet: text.slice(0, 80),
      tail: text.slice(-60),
    };
  })()`;
};

// Get the center of the Nth occurrence of a word inside paragraph's plain text nodes.
const wordRectScript = (paraId, word, nth) => {
  return `(() => {
    const p = document.getElementById(${JSON.stringify(paraId)});
    const r = document.createRange();
    let seen = 0;
    for (const tn of p.childNodes) {
      if (tn.nodeType !== 3) continue;
      let i = -1;
      while ((i = tn.textContent.indexOf(${JSON.stringify(word)}, i + 1)) !== -1) {
        seen++;
        if (seen === ${nth}) {
          r.setStart(tn, i); r.setEnd(tn, i + ${JSON.stringify(word)}.length);
          const b = r.getBoundingClientRect();
          return { found: true, x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height };
        }
      }
    }
    return { found: false, seen };
  })()`;
};

const markerRectScript = (markerId) => {
  return `(() => {
    const el = document.getElementById(${JSON.stringify(markerId)});
    el.scrollIntoView({ block: 'center' });
    const b = el.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height };
  })()`;
};

async function main() {
  const engine = BROWSER === 'chromium' ? chromium : webkit;
  const browser = await engine.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
  await page.goto('file://' + FILE, { waitUntil: 'load' });
  // let webfonts settle like the real app
  try { await page.evaluate(() => document.fonts.ready); } catch {}
  await sleep(800);
  const fontInfo = await page.evaluate(() => {
    const el = document.getElementById('v2e');
    return {
      soraLoaded: document.fonts.check('14px Sora'),
      computedV2: getComputedStyle(el.closest('.v2')).fontFamily,
      glyphInSora: document.fonts.check('14px Sora', '公园'),
    };
  });

  const variants = ['v1', 'v2', 'v3', 'v4'];
  const cases = [];
  for (const v of variants) {
    cases.push({ v, lang: 'en', mode: 'marked', target: `${v}e`, para: `${v}-en` });
    cases.push({ v, lang: 'en', mode: 'mid', word: 'riverbank', nth: 3, para: `${v}-en` });
    cases.push({ v, lang: 'zh', mode: 'marked', target: `${v}z`, para: `${v}-zh` });
    cases.push({ v, lang: 'zh', mode: 'mid', word: '风景', nth: 3, para: `${v}-zh` });
  }

  const results = [];
  for (const c of cases) {
    await page.evaluate(() => window.getSelection().removeAllRanges());
    let rect;
    if (c.mode === 'marked') {
      // scroll marker into view (handles page scroll AND v4 inner scroll container)
      await page.evaluate(markerRectScript(c.target));
      rect = await page.evaluate(markerRectScript(c.target));
    } else {
      // scroll paragraph into view, then locate the word
      await page.evaluate(`document.getElementById(${JSON.stringify(c.para)}).scrollIntoView({block:'center'})`);
      rect = await page.evaluate(wordRectScript(c.para, c.word, c.nth));
    }
    if (rect.found === false) {
      results.push({ ...c, error: 'word not found, seen=' + rect.seen });
      continue;
    }
    // sanity: what caret position resolves at this point
    const caret = await page.evaluate(
      `(() => { const r = document.caretRangeFromPoint(${rect.x}, ${rect.y}); ` +
      `if (!r) return 'null'; return { node: r.startContainer.nodeType === 3 ? 'text' : 'el', off: r.startOffset, ` +
      `ctx: (r.startContainer.textContent||'').slice(Math.max(0,r.startOffset-3), r.startOffset+3) }; })()`
    );
    await page.mouse.dblclick(rect.x, rect.y);
    await sleep(120);
    const sel = await page.evaluate(selInfoScript(c.para));
    results.push({ ...c, point: { x: +rect.x.toFixed(1), y: +rect.y.toFixed(1) }, caret, sel });
  }

  fs.writeFileSync(OUT, JSON.stringify({ browser: BROWSER, engineVersion: browser.version(), fontInfo, results }, null, 2));
  for (const r of results) {
    const sel = r.sel || {};
    console.log(
      `[${r.v}/${r.lang}/${r.mode}]`.padEnd(14),
      'len=' + String(sel.len ?? '?').padEnd(4),
      'sel=' + JSON.stringify((sel.text || r.error || '').slice(0, 40)),
      sel.startOff != null ? `offs=${sel.startOff}..${sel.endOff}` : '',
      sel.anchorIn === false || sel.focusIn === false ? 'CROSS-PARA' : ''
    );
  }
  await browser.close();
}

main().catch((e) => { console.error('DRIVER-FAIL', e); process.exit(1); });
