// Live web search via DuckDuckGo html endpoint. Usage: node websearch.mjs "query"
const q = process.argv[2];
const r = await fetch('https://duckduckgo.com/html/?q=' + encodeURIComponent(q), {
  headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
});
const html = await r.text();
const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/g;
let m, n = 0;
const decode = (s) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
while ((m = re.exec(html)) && n < 12) {
  let url = m[1];
  const uddg = url.match(/[?&]uddg=([^&]+)/);
  if (uddg) url = decodeURIComponent(uddg[1]);
  console.log('- ' + decode(m[2]) + '\n  ' + url);
  n++;
}
if (n === 0) console.log('NO RESULTS (len=' + html.length + ')');
