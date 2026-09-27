const get = (u) => fetch('http://localhost:1420' + u).then((r) => r.text());
const idx = (css, cls) => css.indexOf(cls);
(async () => {
  const css = await get('/src/index.css');
  const i = idx(css, '.w-\\[360px\\]');
  console.log('index of .w-\\[360px\\] rule:', i);
  if (i >= 0) console.log('rule text:', JSON.stringify(css.slice(i, i + 40)));
  console.log('index of .inline-block:', idx(css, '.inline-block'));
  console.log('index of .max-w-full:', idx(css, '.max-w-full'));
})();
