// CDP driver: double-click word-selection repro for CSS zoom vs transform:scale.
// Usage: node cdp-repro.mjs <debugPort> <abs-path-to-html>
const PORT = process.argv[2] || '9333';
const FILE = process.argv[3];
const URL = 'file://' + FILE;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log('[repro]', ...a);

async function main() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' });
  const tab = await res.json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });

  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  const send = (method, params = {}) => new Promise((resolve) => {
    const mid = ++id;
    pending.set(mid, resolve);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
    return r.result ? r.result.result.value : undefined;
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 1600, deviceScaleFactor: 1, mobile: false });
  log('navigating to', URL);
  await send('Page.navigate', { url: URL });
  await sleep(1500);
  log('url now:', await ev('location.href'));

  const rectExpr = (divId, pIdx, word) => `(() => {
    const p = document.querySelectorAll('#${divId} p')[${pIdx}];
    const tn = p.firstChild;
    const i = tn.textContent.indexOf(${JSON.stringify(word)});
    const r = document.createRange();
    r.setStart(tn, i); r.setEnd(tn, i + ${JSON.stringify(word)}.length);
    const b = r.getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height, cx: b.x + b.width / 2, cy: b.y + b.height / 2 };
  })()`;
  const clearSel = () => ev('getSelection().removeAllRanges()');
  const getSel = () => ev('window.report()');
  const atPoint = (x, y) => ev(`(() => {
    const el = document.elementFromPoint(${x}, ${y});
    return el ? el.tagName + '|' + (el.textContent || '').slice(0, 25) : 'null';
  })()`);
  const caretAt = (x, y) => ev(`(() => {
    const p = document.caretRangeFromPoint(${x}, ${y});
    if (!p) return 'null';
    const t = p.startContainer.textContent || '';
    return 'off=' + p.startOffset + ' ctx=' + t.slice(Math.max(0, p.startOffset - 4), p.startOffset + 4);
  })()`);
  const dblclick = async (x, y) => {
    for (const [type, count] of [['mousePressed', 1], ['mouseReleased', 1], ['mousePressed', 2], ['mouseReleased', 2]]) {
      await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: count });
      await sleep(40);
    }
    await sleep(150);
  };

  const cases = [
    ['a', 0, 'quick'], ['a', 1, '测试'],
    ['b', 0, 'quick'], ['b', 1, '测试'],
    ['c', 0, 'quick'], ['c', 1, '测试'],
  ];

  const results = [];
  for (const [divId, pIdx, word] of cases) {
    await ev('window.scrollTo(0, 0)');
    await sleep(60);
    const rect = await ev(rectExpr(divId, pIdx, word));
    const rec = { div: divId, word, rect: { cx: +rect.cx.toFixed(1), cy: +rect.cy.toFixed(1) }, attempts: [] };
    for (const attempt of ['visual', 'unzoomed']) {
      let x = rect.cx, y = rect.cy;
      if (attempt === 'unzoomed') {
        const divRect = await ev(`(() => { const r = document.getElementById('${divId}').getBoundingClientRect(); return { x: r.x, y: r.y }; })()`);
        const f = divId === 'a' ? 1.5 : 1;
        x = divRect.x + (rect.cx - divRect.x) / f;
        y = divRect.y + (rect.cy - divRect.y) / f;
      }
      await clearSel();
      const hit = await atPoint(x, y);
      const caret = await caretAt(x, y);
      await dblclick(x, y);
      const sel = await getSel();
      const a = { attempt, x: +x.toFixed(1), y: +y.toFixed(1), elementFromPoint: hit, caret, selected: JSON.stringify(sel) };
      rec.attempts.push(a);
      log(divId, word, attempt, JSON.stringify(a));
    }
    results.push(rec);
  }

  console.log('FINAL ' + JSON.stringify(results));
  try { await fetch(`http://127.0.0.1:${PORT}/json/close/${tab.id}`); } catch {}
  ws.close();
  process.exit(0);
}

main().catch(e => { console.error('DRIVER-FAIL', e); process.exit(1); });
