// Launch-day submission: IndexNow ping (Bing + IndexNow-participating engines).
// Google/Bing sitemap submission happens in their consoles (GSC + Bing
// Webmaster) — this script covers the IndexNow side.
//
// Usage (after DNS is live and the site is deployed):
//   node scripts/submit.mjs
import '../pipeline/proxy.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const SITE = 'https://skivio.org';

const key = fs.readFileSync(path.join(root, '.indexnow-key'), 'utf8').trim().split('=')[1];

// Collect every generated URL from the built sitemaps.
const outDir = path.join(root, 'out');
const urls = [];
for (const f of ['sitemap-resorts.xml', 'sitemap-vs.xml', 'sitemap-pass.xml', 'sitemap-geo.xml']) {
  const xml = fs.readFileSync(path.join(outDir, f), 'utf8');
  for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) urls.push(m[1]);
}
console.log(`${urls.length} URLs to submit`);

// IndexNow accepts up to 10k URLs per POST.
const res = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({
    host: 'skivio.org',
    key,
    keyLocation: `${SITE}/${key}.txt`,
    urlList: urls.slice(0, 10000),
  }),
});
console.log(`IndexNow response: HTTP ${res.status}`);
if (!res.ok) console.log(await res.text());
console.log('Remember: submit https://skivio.org/sitemap.xml in Google Search Console AND Bing Webmaster Tools.');
