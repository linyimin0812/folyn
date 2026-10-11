// Drill-down: toggles, zoom, scroll state, mouse jitter. Usage: node drill.mjs <webkit|chromium> <html> <out.json>
import { webkit, chromium } from '/tmp/webkit-bisect/node_modules/playwright/index.mjs';
import fs from 'node:fs';

const BROWSER = process.argv[2] || 'webkit';
const FILE = process.argv[3];
const OUT = process.argv[4];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getSel(page, paraId) {
  return page.evaluate(`(() => {
    const s = window.getSelection();
    const p = document.getElementById(${JSON.stringify(paraId)});
    const text = s.toString();
    function abs(node, off) {
      let n = node; while (n && n.parentNode !== p && n !== p) n = n.parentNode;
      if (!n || n === p) return -1;
      let acc = 0;
      for (const c of p.childNodes) { if (c === n) return acc + off; acc += c.textContent.length; }
      return -1;
    }
    return { len: text.length, text: text.slice(0, 60), tail: text.slice(-40),
             startOff: abs(s.anchorNode, s.anchorOffset), endOff: abs(s.focusNode, s.focusOffset),
             anchorIn: p.contains(s.anchorNode), focusIn: p.contains(s.focusNode) };
  })()`);
}

async function markerCenter(page, id, preScroll) {
  if (preScroll) await page.evaluate(
    `document.getElementById(${JSON.stringify(preScroll.el)}).scrollTop = ${preScroll.top}`);
  return page.evaluate(`(() => {
    const el = document.getElementById(${JSON.stringify(id)});
    const b = el.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  })()`);
}

async function dblclick(page, x, y) {
  await page.mouse.dblclick(x, y);
  await sleep(120);
}

async function dblclickJitter(page, x, y, dx, dy) {
  await page.mouse.move(x, y);
  await page.mouse.down();  await page.mouse.move(x + dx, y + dy, { steps: 1 });
  await page.mouse.up();
  await page.mouse.down();  await page.mouse.up();
  await sleep(120);
}

async function main() {
  const engine = BROWSER === 'chromium' ? chromium : webkit;
  const browser = await engine.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
  await page.goto('file://' + FILE, { waitUntil: 'load' });
  try { await page.evaluate(() => document.fonts.ready); } catch {}
  await sleep(600);
  const results = [];

  const clear = () => page.evaluate(() => window.getSelection().removeAllRanges());

  // ── A. property toggles on V4 (marked word, en + zh) ──
  const toggles = [
    ['baseline', ''],
    ['line-height normal', '.v3 { line-height: normal !important; }'],
    ['font-family system-ui', '.v3 { font-family: system-ui !important; }'],
    ['overflow-wrap normal', '.v3 { overflow-wrap: normal !important; }'],
    ['scrollbar-gutter auto', '.v4-outer { scrollbar-gutter: auto !important; }'],
    ['font-smoothing antialiased', 'body { -webkit-font-smoothing: antialiased; }'],
    ['zoom 1.25 on preview', '.v3 { zoom: 1.25; }'],
  ];
  for (const [name, css] of toggles) {
    if (css) await page.addStyleTag({ content: css });
    for (const [mk, para] of [['v4e', 'v4-en'], ['v4z', 'v4-zh']]) {
      await clear();
      const pt = await markerCenter(page, mk);
      await dblclick(page, pt.x, pt.y);
      results.push({ group: 'toggle', name, word: mk, ...await getSel(page, para) });
    }
    if (css) await page.evaluate(`for (const s of document.querySelectorAll('style[data-x]')) s.remove();`);
    if (css) await page.reload({ waitUntil: 'load' });
    try { await page.evaluate(() => document.fonts.ready); } catch {}
    await sleep(300);
  }

  // ── B. mouse jitter between the two clicks (double-click-drag) ──
  for (const [dx, dy, label] of [[0, 0, 'no jitter'], [4, 0, '+4px x'], [0, 3, '+3px y'], [60, 0, '+60px x'], [0, 40, '+40px y']]) {
    await clear();
    const pt = await markerCenter(page, 'v4e');
    await dblclickJitter(page, pt.x, pt.y, dx, dy);
    results.push({ group: 'jitter', name: label, word: 'v4e', ...await getSel(page, 'v4-en') });
  }

  // ── C. scrolled inner container (hit-test offset state) ──
  for (const top of [0, 200, 600]) {
    await clear();
    const pt = await markerCenter(page, 'v4e', { el: 'v4', top });
    await dblclick(page, pt.x, pt.y);
    results.push({ group: 'scrolled-container', name: `scrollTop=${top}`, word: 'v4e', ...await getSel(page, 'v4-en') });
  }

  // ── D. scrolled page + V3 (no inner scroll) ──
  for (const top of [0, 800]) {
    await clear();
    await page.evaluate(`window.scrollTo(0, ${top})`);
    await sleep(80);
    const pt = await markerCenter(page, 'v3e');
    await dblclick(page, pt.x, pt.y);
    results.push({ group: 'scrolled-page', name: `window.scrollY=${top}`, word: 'v3e', ...await getSel(page, 'v3-en') });
  }

  // ── E. layout shift between the two clicks (mechanism demo) ──
  for (const [shift, label] of [[120, 'scrollTop +120 between clicks'], [-120, 'scrollTop -120 between clicks']]) {
    await clear();
    const pt = await markerCenter(page, 'v4e');
    await page.mouse.move(pt.x, pt.y);
    await page.mouse.down();
    await page.mouse.up();
    await page.evaluate(`document.getElementById('v4').scrollTop += ${shift}`);
    await page.mouse.down();
    await page.mouse.up();
    await sleep(120);
    results.push({ group: 'layout-shift', name: label, word: 'v4e', ...await getSel(page, 'v4-en') });
  }

  // ── F. retina (deviceScaleFactor 2) baseline ──
  const page2 = await browser.newPage({ viewport: { width: 1000, height: 900 }, deviceScaleFactor: 2 });
  await page2.goto('file://' + FILE, { waitUntil: 'load' });
  try { await page2.evaluate(() => document.fonts.ready); } catch {}
  await sleep(400);
  for (const [mk, para] of [['v3e', 'v3-en'], ['v4e', 'v4-en'], ['v4z', 'v4-zh']]) {
    await page2.evaluate(() => window.getSelection().removeAllRanges());
    const pt = await page2.evaluate(`(() => { const el = document.getElementById('${mk}'); const b = el.getBoundingClientRect(); return { x: b.x + b.width/2, y: b.y + b.height/2 }; })()`);
    await page2.mouse.dblclick(pt.x, pt.y);
    await sleep(120);
    const sel = await page2.evaluate(`(() => { const s = window.getSelection(); return { len: s.toString().length, text: s.toString().slice(0, 40) }; })()`);
    results.push({ group: 'retina-dsf2', name: 'deviceScaleFactor=2', word: mk, ...sel });
  }
  await page2.close();

  fs.writeFileSync(OUT, JSON.stringify({ browser: BROWSER, engineVersion: browser.version(), results }, null, 2));
  for (const r of results) {
    console.log(`[${r.group}/${r.name}]`.padEnd(28), 'word=' + r.word, 'len=' + String(r.len).padEnd(4),
      'offs=' + r.startOff + '..' + r.endOff, JSON.stringify((r.text || '').slice(0, 30)),
      r.anchorIn === false || r.focusIn === false ? 'CROSS-PARA' : '');
  }
  await browser.close();
}

main().catch((e) => { console.error('DRILL-FAIL', e); process.exit(1); });
