const css = await fetch('http://localhost:1420/src/index.css').then((r) => r.text());
const classes = [
  '.w-\\[360px\\]',        // trigger width (515d21d0, latest)
  '.max-w-\\[360px\\]',    // rootDir input cap
  '.max-w-\\[720px\\]',    // ReportSettingsView wrapper
  '.max-w-\\[520px\\]',    // panel cap widened in 881f1a8e (visible to user)
  '.min-w-\\[220px\\]',    // old panel min (pre-647d4975)
  '.w-\\[220px\\]',        // ScriptRuntimesSettings static class
  '.h-\\[28px\\]',         // trigger height
  '.w-\\[260px\\]',        // entity graph sidebar
];
for (const c of classes) console.log(css.includes(c) ? 'YES' : 'NO ', c);
