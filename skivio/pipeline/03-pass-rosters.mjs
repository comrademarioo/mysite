// Step 3 — pass roster ingest (facts, not copyrightable expression).
// Refreshes pass_resorts from each pass's public source. Small table,
// re-run each season with SEASON bumped.
//
// Source per pass (found empirically 2026-07):
//   ikon  — Sanity CMS public dataset the site itself reads (names + coords).
//           Tier: existing DB tier kept where present (press-verified),
//           new/unknown destinations default to limited/7 (full-pass partner norm).
//   indy  — /our-resorts page is server-rendered; roster = /our-resorts/{slug}
//           links, 2 days each by definition.
//   mountain-collective — /resorts/ page is server-rendered; names in <h3>,
//           2 days each by definition.
//   epic  — epicpass.com serves a bot-wall stub to non-browser clients and
//           headless Chromium is blocked by this environment's egress proxy,
//           so the scrape usually fails here → the seed roster (verified
//           against 2026-27 press coverage) is kept. Re-run from a normal
//           machine to scrape live.
//
// Failed/implausible scrapes NEVER wipe existing rows. Unmatched roster rows
// go to data/unmatched-roster.csv for manual mapping — never silently dropped.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './proxy.mjs';
import { getPool } from './db.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const SEASON = process.env.SEASON || '2026-27';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/\bmt\b\.?/g, 'mount').replace(/\bmtn\b\.?/g, 'mountain')
  .replace(/,\s*[a-z]{2}$/g, '') // trailing ", CO" style state suffixes
  .replace(/\b(ski (resort|area|hill|valley|mountain)|resort|mountain resort|ski and snowboard park)\b/g, '')
  .replace(/[^a-z0-9]+/g, ' ').trim();
const similar = (a, b) => {
  const na = norm(a), nb = norm(b);
  return !!na && !!nb && (na === nb || na.includes(nb) || nb.includes(na));
};

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

// Each fetcher returns [{ name, lat?, lng?, access, days_limit }].
const FETCHERS = {
  async epic() {
    // Roster page is 404 and the site bot-walls plain clients; kept for runs
    // from unrestricted machines. resortName JSON islands appear on rendered pages.
    const html = await fetchText('https://www.epicpass.com/region/all-resorts.aspx');
    const out = [];
    for (const m of html.matchAll(/"resortName"\s*:\s*"([^"]+)"/g)) {
      out.push({ name: m[1], access: 'unlimited', days_limit: null });
    }
    return out;
  },
  async ikon() {
    // The Sanity dataset the site reads client-side; public, no auth.
    const groq = '*[_type=="destination" && defined(fullName)]{fullName, "lat": coords.lat, "lng": coords.lng}';
    const url = `https://bjsgnxuy.api.sanity.io/v2023-01-01/data/query/ikon-prod?query=${encodeURIComponent(groq)}`;
    const json = JSON.parse(await fetchText(url));
    return (json.result || [])
      .filter((d) => d.fullName && !/heli-skiing|skibig3/i.test(d.fullName))
      .map((d) => ({
        name: d.fullName.replace(/,\s*[A-Z]{2}$/, '').replace(/,\s*(Japan|France|Italy|New Zealand|Switzerland|Austria|Andorra|Australia|Chile|Canada)$/i, '').trim(),
        lat: d.lat, lng: d.lng,
        access: 'limited', days_limit: 7, // refined against existing tiers below
      }));
  },
  async indy() {
    const html = await fetchText('https://www.indyskipass.com/our-resorts');
    const slugs = new Set();
    for (const m of html.matchAll(/href="\/our-resorts\/([a-z0-9-]{3,80})"/g)) slugs.add(m[1]);
    const regions = new Set(['west', 'rockies', 'midwest', 'east', 'mid-atlantic', 'canada', 'japan', 'south-america', 'europe', 'alaska']);
    return [...slugs]
      .filter((s) => !regions.has(s))
      .map((s) => ({ name: s.replace(/-/g, ' '), access: 'limited', days_limit: 2 }));
  },
  async 'mountain-collective'() {
    const html = await fetchText('https://mountaincollective.com/resorts/');
    const out = [];
    for (const m of html.matchAll(/<h3[^>]*>\s*([^<]{3,60}?)\s*<\/h3>/g)) {
      const name = m[1].replace(/&#8217;/g, "'").replace(/&amp;/g, '&').trim();
      if (/newsletter|sign ?up|faq|contact|follow|policies|quicklinks/i.test(name)) continue;
      out.push({ name, access: 'limited', days_limit: 2 });
    }
    return out;
  },
};

const PASSES = [
  { slug: 'epic', name: 'Epic Pass' },
  { slug: 'ikon', name: 'Ikon Pass' },
  { slug: 'indy', name: 'Indy Pass' },
  { slug: 'mountain-collective', name: 'Mountain Collective' },
];

async function main() {
  const pool = getPool();
  const { rows: resorts } = await pool.query(
    'SELECT id, name, region, lat::float, lng::float FROM resorts');

  function matchResort(entry) {
    // name+proximity when the roster provides coords, else unique name match.
    if (entry.lat != null && entry.lng != null) {
      // 40 km: roster coords are marketing-grade (Mt. Bachelor's is ~22 km
      // off-summit). Name similarity is still required, and coords guard
      // against same-name resorts on other continents (Sun Valley, Japan).
      const named = resorts
        .map((r) => ({ r, km: haversineKm(entry.lat, entry.lng, r.lat, r.lng) }))
        .filter((x) => x.km <= 40 && similar(entry.name, x.r.name))
        .sort((a, b) => a.km - b.km);
      return named.length ? { hit: named[0].r } : { hit: null, reason: 'no match' };
    }
    const named = resorts.filter((r) => similar(entry.name, r.name));
    if (named.length === 1) return { hit: named[0] };
    return { hit: null, reason: named.length ? 'ambiguous' : 'no match' };
  }

  const unmatched = [];
  for (const p of PASSES) {
    const { rows: [passRow] } = await pool.query(
      `INSERT INTO passes (slug, name, season) VALUES ($1,$2,$3)
       ON CONFLICT (slug) DO UPDATE SET season = EXCLUDED.season
       RETURNING id`,
      [p.slug, p.name, SEASON]);

    let roster;
    try {
      roster = await FETCHERS[p.slug]();
    } catch (e) {
      console.error(`  ${p.name}: fetch failed (${e.message.slice(0, 120)}) — keeping existing rows`);
      continue;
    }
    console.log(`${p.name}: ${roster.length} roster entries scraped`);
    if (roster.length < 5) {
      // An empty/tiny roster means the extractor failed, not that the pass
      // shrank to nothing — never wipe existing rows on a failed parse.
      console.error(`  ${p.name}: implausibly small roster — keeping existing rows`);
      continue;
    }

    // Preserve verified tiers across the wholesale re-seed.
    const { rows: prevTiers } = await pool.query(
      'SELECT resort_id, access, days_limit FROM pass_resorts WHERE pass_id = $1', [passRow.id]);
    const tierByResort = new Map(prevTiers.map((t) => [t.resort_id, t]));

    await pool.query('DELETE FROM pass_resorts WHERE pass_id = $1', [passRow.id]);
    let inserted = 0;
    for (const entry of roster) {
      const { hit, reason } = matchResort(entry);
      if (!hit) { unmatched.push({ pass: p.slug, name: entry.name, reason }); continue; }
      const prev = tierByResort.get(hit.id);
      await pool.query(
        `INSERT INTO pass_resorts (pass_id, resort_id, access, days_limit)
         VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
        [passRow.id, hit.id, prev?.access ?? entry.access, prev ? prev.days_limit : entry.days_limit]);
      inserted++;
    }
    console.log(`  ${inserted} matched → pass_resorts (tiers kept from prior rows where present)`);
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  const file = path.join(DATA_DIR, 'unmatched-roster.csv');
  fs.writeFileSync(
    file,
    'pass,roster_name,reason\n' + unmatched.map((u) => `"${u.pass}","${u.name}","${u.reason}"`).join('\n') + '\n');
  console.log(`${unmatched.length} unmatched roster rows → ${file}`);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
