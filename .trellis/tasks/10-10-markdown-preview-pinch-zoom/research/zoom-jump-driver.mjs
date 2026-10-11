// Playwright driver for zoom-jump-repro.html
// Usage: node zoom-jump-driver.mjs  (runs webkit + chromium x variants, prints summary,
// writes zoom-jump-results.json next to this file)
import { webkit, chromium } from '/tmp/webkit-bisect/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HTML = 'file://' + path.join(HERE, 'zoom-jump-repro.html');

// Variants: A = per-frame compensate (overflow-anchor: none, matches app CSS)
//           D = per-frame compensate, engine scroll anchoring LEFT ON (no overflow-anchor rule)
//           B = no scrollTop writes; C = single final scrollTop write
const RUNS = [
  { id: 'V-A per-frame, overflow-anchor:none (current app)', q: 'variant=A&anchor=none' },
  { id: 'V-D per-frame, anchoring on (no overflow-anchor)', q: 'variant=A&anchor=default' },
  { id: 'V-B no scrollTop writes', q: 'variant=B&anchor=none' },
  { id: 'V-B2 no scrollTop writes, anchoring ON', q: 'variant=B&anchor=default' },
  { id: 'V-C single final scrollTop write', q: 'variant=C&anchor=none' },
  { id: 'V-E measured anchor-node pinning', q: 'variant=E&anchor=none' },
  { id: 'V-A per-frame, ZOOM OUT 1.5->1', q: 'variant=A&anchor=none&dir=out' },
  { id: 'V-E anchor-node pinning, ZOOM OUT 1.5->1', q: 'variant=E&anchor=none&dir=out' },
];

const raf = (ms) => new Promise((r) => setTimeout(r, ms));

function analyze(trace, final_) {
  const post = trace.map((t) => t.postVis);
  const deltas = post.slice(1).map((v, i) => v - post[i]);
  const abs = deltas.map(Math.abs);
  const maxAbs = Math.max(0, ...abs);
  const maxIdx = abs.indexOf(maxAbs);
  // jump-then-revert: biggest delta followed by opposite-sign delta >= 50% its size
  let jumpRevert = false, revertInfo = null;
  if (maxAbs > 3) {
    const next = deltas[maxIdx + 1];
    if (next !== undefined && Math.sign(next) === -Math.sign(deltas[maxIdx]) && Math.abs(next) > 0.5 * maxAbs) {
      jumpRevert = true;
      revertInfo = { at: maxIdx + 1, delta: +deltas[maxIdx].toFixed(1), next: +next.toFixed(1) };
    }
  }
  // engine mutated scrollTop between our write (frame i post) and next frame's pre-read?
  let engineMut = 0, mutMax = 0;
  for (let i = 1; i < trace.length; i++) {
    const d = Math.abs(trace[i].preScroll - trace[i - 1].postScroll);
    if (d > 0.5) { engineMut++; mutMax = Math.max(mutMax, d); }
  }
  // same-callback read-back clamp: immediate != intended
  let clamped = 0, clampMax = 0;
  for (const t of trace) {
    if (t.intended === null) continue;
    const d = Math.abs(t.immediate - t.intended);
    if (d > 0.5) { clamped++; clampMax = Math.max(clampMax, d); }
  }
  return {
    frames: trace.length,
    maxFrameDeltaVis: +maxAbs.toFixed(1),
    netDriftVis: +(post[post.length - 1] - post[0]).toFixed(1),
    jumpThenRevert: jumpRevert, revertInfo,
    engineMutatedScrollFrames: engineMut, engineMutatedMaxPx: +mutMax.toFixed(1),
    readbackClampFrames: clamped, readbackClampMaxPx: +clampMax.toFixed(1),
    firstVis: +post[0].toFixed(1), lastVis: +post[post.length - 1].toFixed(1),
    finalSettledVis: final_ ? final_.finalPreVis : undefined,
  };
}

async function runBrowser(name, launch) {
  const browser = await launch();
  const out = {};
  for (const run of RUNS) {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    await page.goto(HTML + '?' + run.q);
    await page.waitForFunction('window.__done === true', null, { timeout: 15000 });
    await raf(150); // let final paint settle
    const data = await page.evaluate(() => ({
      meta: window.__meta, trace: window.__trace, final: window.__final,
      stepTest: window.__stepTest, finalWrite: window.__finalWrite,
      anchorTag: window.__anchorTag,
    }));
    out[run.id] = { meta: data.meta, anchorTag: data.anchorTag, ...analyze(data.trace, data.final), stepTest: data.stepTest, finalWrite: data.finalWrite, trace: data.trace };
    await page.close();
  }
  await browser.close();
  return out;
}

const results = {};
results.webkit = await runBrowser('webkit', () => webkit.launch());
results.chromium = await runBrowser('chromium', () => chromium.launch());

fs.writeFileSync(path.join(HERE, 'zoom-jump-results.json'), JSON.stringify(results, null, 2));

for (const engine of ['webkit', 'chromium']) {
  console.log('=== ' + engine.toUpperCase() + ' ===');
  for (const [id, r] of Object.entries(results[engine])) {
    console.log(`${id}`);
    console.log(`  max |frame-to-frame delta visY| = ${r.maxFrameDeltaVis}px   net drift = ${r.netDriftVis}px   first->last visY ${r.firstVis} -> ${r.lastVis} (settled ${r.finalSettledVis})`);
    console.log(`  jumpThenRevert = ${r.jumpThenRevert}${r.revertInfo ? ' ' + JSON.stringify(r.revertInfo) : ''}`);
    console.log(`  engine mutated scrollTop between frames: ${r.engineMutatedScrollFrames}/${r.frames - 1} frames (max ${r.engineMutatedMaxPx}px)`);
    console.log(`  same-callback read-back != intended (clamp): ${r.readbackClampFrames} frames (max ${r.readbackClampMaxPx}px)`);
    if (r.anchorTag) {
      const av = r.trace.map((t) => t.anchorVis);
      const ad = av.slice(1).map((v, i) => +(v - av[i]).toFixed(1));
      console.log(`  anchorNode=${JSON.stringify(r.anchorTag)} anchorVis max frame delta = ${Math.max(0, ...ad.map(Math.abs))}px (net ${+(av[av.length - 1] - av[0]).toFixed(1)}px)`);
    }
    if (r.stepTest) console.log(`  stepTest z 1->1.5 @scrollTop=300: before=${r.stepTest.before} raw=${r.stepTest.raw} afterLayout=${r.stepTest.afterLayout} nextFrame=${r.stepTest.nextFrame} visBefore=${r.stepTest.visBefore} nextFrameVis=${r.stepTest.nextFrameVis}`);
  }
  console.log('');
}
