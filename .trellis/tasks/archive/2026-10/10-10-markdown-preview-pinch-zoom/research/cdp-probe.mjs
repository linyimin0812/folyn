const PORT = process.argv[2] || '9333';
const t = (ms, label) => new Promise((_, rej) => setTimeout(() => rej(new Error('timeout: ' + label)), ms));
async function step(label, p) {
  console.log('start', label);
  const v = await Promise.race([p, t(8000, label)]);
  console.log('done', label, JSON.stringify(v).slice(0, 200));
  return v;
}
try {
  const ver = await step('version', fetch(`http://127.0.0.1:${PORT}/json/version`).then(r => r.json()));
  const tab = await step('new-tab', fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' }).then(r => r.json()));
  console.log('tab ws url:', tab.webSocketDebuggerUrl);
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await step('ws-open', new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; }));
  const reply = await step('eval', new Promise((ok) => {
    ws.onmessage = (e) => ok(JSON.parse(e.data));
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: '1+1', returnByValue: true } }));
  }));
  console.log('eval result:', JSON.stringify(reply).slice(0, 300));
  process.exit(0);
} catch (e) {
  console.error('FAIL:', e.message);
  process.exit(1);
}
