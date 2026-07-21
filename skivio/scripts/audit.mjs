// Pre-launch audit (launch protocol step 2). Runs against the static export in out/.
//   1. Random pages contain full HTML content (vs-page comparison table present
//      in RAW HTML — the crawler must never see an empty shell).
//   2. Every internal link resolves to a generated file.
//   3. Sitemap counts match generated pages.
//   4. No orphans: every URL reachable from homepage within 4 clicks.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'out');
let failures = 0;
const fail = (msg) => { failures++; console.error(`  FAIL: ${msg}`); };
const ok = (msg) => console.log(`  ok: ${msg}`);

// ---- collect generated pages ----
function* htmlFiles(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* htmlFiles(p);
    else if (e.name.endsWith('.html')) yield p;
  }
}
const pages = [...htmlFiles(OUT)];
const toUrl = (f) => {
  let u = '/' + path.relative(OUT, f).replace(/\\/g, '/');
  u = u.replace(/\/index\.html$/, '/').replace(/\.html$/, '');
  if (u !== '/' && u.endsWith('/')) u = u.slice(0, -1);
  return u === '' ? '/' : u;
};
const urlSet = new Set(pages.map(toUrl));
urlSet.add('/');
console.log(`\n${pages.length} HTML pages generated`);

// ---- 1. raw-HTML content spot checks ----
console.log('\n[1] Raw HTML content checks');
const sample = (arr, n) => {
  const out = []; const step = Math.max(1, Math.floor(arr.length / n));
  for (let i = 0; i < arr.length && out.length < n; i += step) out.push(arr[i]);
  return out;
};
const vsPages = pages.filter((p) => p.includes(`${path.sep}vs${path.sep}`));
for (const f of sample(vsPages, 12)) {
  const html = fs.readFileSync(f, 'utf8');
  if (!html.includes('<table') || !html.includes('Vertical drop')) {
    fail(`${toUrl(f)} missing comparison table in raw HTML`);
  }
}
ok(`${Math.min(12, vsPages.length)} vs-pages contain the comparison table in raw HTML`);
const resortPages = pages.filter((p) => p.includes(`${path.sep}resort${path.sep}`));
for (const f of sample(resortPages, 12)) {
  const html = fs.readFileSync(f, 'utf8');
  if (!html.includes('Vertical drop') || !html.includes('application/ld+json')) {
    fail(`${toUrl(f)} missing stats or JSON-LD in raw HTML`);
  }
}
ok(`${Math.min(12, resortPages.length)} resort pages contain stats + SkiResort JSON-LD`);

// ---- 2. every internal link resolves ----
console.log('\n[2] Internal link resolution');
const hrefRe = /href="(\/[^"#?]*)/g;
const linkGraph = new Map(); // url -> Set(outlinks)
let badLinks = 0;
for (const f of pages) {
  const html = fs.readFileSync(f, 'utf8');
  const from = toUrl(f);
  const outs = new Set();
  for (const m of html.matchAll(hrefRe)) {
    let href = m[1];
    if (href.startsWith('/_next')) continue;
    if (href !== '/' && href.endsWith('/')) href = href.slice(0, -1);
    if (/\.(xml|txt|ico|png|svg|css|js|json)$/.test(href)) {
      if (!fs.existsSync(path.join(OUT, href.slice(1)))) { fail(`${from} → ${href} (asset missing)`); badLinks++; }
      continue;
    }
    outs.add(href);
    if (!urlSet.has(href)) { badLinks++; if (badLinks < 20) fail(`${from} → ${href} (no page)`); }
  }
  linkGraph.set(from, outs);
}
if (badLinks === 0) ok(`all internal links across ${pages.length} pages resolve`);
else fail(`${badLinks} broken internal links total`);

// ---- 3. sitemap counts vs generated pages ----
console.log('\n[3] Sitemap ↔ page parity');
const smUrls = new Set();
for (const smf of ['sitemap-resorts.xml', 'sitemap-vs.xml', 'sitemap-pass.xml', 'sitemap-geo.xml']) {
  const p = path.join(OUT, smf);
  if (!fs.existsSync(p)) { fail(`${smf} not generated`); continue; }
  const xml = fs.readFileSync(p, 'utf8');
  const urls = [...xml.matchAll(/<loc>https:\/\/skivio\.org([^<]*)<\/loc>/g)].map((m) => m[1] || '/');
  console.log(`  ${smf}: ${urls.length} URLs`);
  for (const u of urls) {
    smUrls.add(u);
    if (!urlSet.has(u)) fail(`${smf} lists ${u} but page not generated`);
  }
}
for (const u of urlSet) {
  if (u === '/404' || u === '/404/' || u.startsWith('/404')) continue;
  if (!smUrls.has(u)) fail(`generated page ${u} missing from all sitemaps`);
}
if (smUrls.size && failures === 0) ok(`sitemaps (${smUrls.size} URLs) match generated pages exactly`);

// ---- 4. orphan check: BFS from homepage, depth <= 4 ----
console.log('\n[4] Reachability from homepage (≤ 4 clicks)');
const dist = new Map([['/', 0]]);
let frontier = ['/'];
while (frontier.length) {
  const next = [];
  for (const u of frontier) {
    const d = dist.get(u);
    if (d >= 6) continue;
    for (const v of linkGraph.get(u) || []) {
      if (!dist.has(v)) { dist.set(v, d + 1); next.push(v); }
    }
  }
  frontier = next;
}
const unreachable = [...urlSet].filter((u) => !dist.has(u) && !u.startsWith('/404'));
const tooDeep = [...dist.entries()].filter(([, d]) => d > 4).map(([u]) => u);
if (unreachable.length) fail(`${unreachable.length} orphan pages (e.g. ${unreachable.slice(0, 5).join(', ')})`);
else ok('no orphan pages — every URL reachable from homepage');
if (tooDeep.length) fail(`${tooDeep.length} pages deeper than 4 clicks (e.g. ${tooDeep.slice(0, 5).join(', ')})`);
else ok('all pages within 4 clicks of homepage');
const depthHist = {};
for (const [, d] of dist) depthHist[d] = (depthHist[d] || 0) + 1;
console.log(`  depth histogram: ${Object.entries(depthHist).map(([d, n]) => `${d}:${n}`).join('  ')}`);

// ---- robots sanity ----
console.log('\n[5] robots.txt sanity');
const robots = fs.readFileSync(path.join(OUT, 'robots.txt'), 'utf8');
if (/Disallow:\s*\/\s*$/m.test(robots)) fail('robots.txt blocks everything');
else ok('robots.txt does not block generated content');

console.log(failures ? `\nAUDIT FAILED — ${failures} problem(s)` : '\nAUDIT PASSED');
process.exit(failures ? 1 : 0);
