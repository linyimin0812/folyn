// Geometry probe: how do scrollHeight / md-preview box size / sentinel position
// actually change with CSS zoom? Separates "coordinate quirk" from "reflow".
import { webkit, chromium } from '/tmp/webkit-bisect/node_modules/playwright/index.mjs';

const HTML = 'file:///Users/yiminlin/project/folyn/.trellis/tasks/10-10-markdown-preview-pinch-zoom/research/zoom-jump-repro.html?variant=B&anchor=none';

const engines = { webkit: webkit, chromium: chromium };
for (const name of ['webkit', 'chromium']) {
  const browser = await engines[name].launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  await page.goto(HTML);
  await page.waitForFunction('window.__done === true');
  const rows = await page.evaluate(() => {
    const sc = document.getElementById('scroller');
    const md = document.getElementById('md');
    const st = document.getElementById('sentinel');
    sc.scrollTop = 609;
    const out = [];
    for (const z of [1, 1.05, 1.1, 1.2, 1.3, 1.4, 1.5]) {
      sc.style.setProperty('--md-zoom', String(z));
      void sc.scrollHeight;
      const scR = sc.getBoundingClientRect();
      const mdR = md.getBoundingClientRect();
      const stR = st.getBoundingClientRect();
      out.push({
        z,
        scrollH: sc.scrollHeight,
        mdRectW: +mdR.width.toFixed(1), mdRectH: +mdR.height.toFixed(1),
        mdClientW: md.clientWidth,
        sentinelVisY: +(stR.top - scR.top).toFixed(1),
        paraRectH: +(document.querySelector('.md-preview p').getBoundingClientRect().height).toFixed(2),
      });
    }
    return out;
  });
  console.log('=== ' + name + ' (scrollTop fixed 609, pane avail width 836) ===');
  console.log('z     scrollH  mdRectW  mdRectH  mdClientW  sentinelVisY  paraRectH');
  for (const r of rows) {
    console.log(Object.values(r).map((v) => String(v).padEnd(9)).join(' '));
  }
  await browser.close();
}
