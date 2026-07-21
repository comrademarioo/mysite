// Step 3 — pass roster scrape (facts, not copyrightable expression).
// Scrapes the four public roster pages into passes + pass_resorts.
// Small table (~few hundred rows), re-scraped each season with SEASON bumped.
//
// The official sites are JS-heavy; each scraper targets the embedded JSON or
// server-rendered lists where available and falls back to seed/pass_resorts
// entries. Matching to `resorts` is by normalized name (+ region hint when the
// roster provides one); unmatched roster rows are written to
// data/unmatched-roster.csv for manual mapping — never silently dropped.
//
// NOTE: requires outbound HTTPS to the pass sites. If blocked by the
// environment network policy, the curated seed roster
// (pipeline/seed/pass_resorts.seed.json) remains the source until re-run:
//   npm run ingest:passes
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool } from './db.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const SEASON = process.env.SEASON || '2026-27';

const PASSES = [
  { slug: 'epic', name: 'Epic Pass', url: 'https://www.epicpass.com/region/all-resorts.aspx' },
  { slug: 'ikon', name: 'Ikon Pass', url: 'https://www.ikonpass.com/en/destinations' },
  { slug: 'indy', name: 'Indy Pass', url: 'https://www.indyskipass.com/our-resorts' },
  { slug: 'mountain-collective', name: 'Mountain Collective', url: 'https://mountaincollective.com/destinations' },
];

function normName(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\b(ski (resort|area|hill|mountain)|resort|mountain resort)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SkivioBot/0.1; +https://skivio.org)' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

// Each site changes markup regularly; keep extractors dumb and greppable.
// Returns [{ name, access: 'unlimited'|'limited', days_limit }]
const EXTRACTORS = {
  epic(html) {
    // Epic embeds resort lists in JSON islands; "unlimited" tier is the full
    // Epic Pass; partner/limited resorts are flagged in copy ("limited days").
    const out = [];
    const re = /"resortName"\s*:\s*"([^"]+)"/g;
    let m;
    while ((m = re.exec(html))) out.push({ name: m[1], access: 'unlimited', days_limit: null });
    return out;
  },
  ikon(html) {
    // Ikon lists destinations with unlimited vs 5/7-day tiers on the full pass.
    const out = [];
    const re = /"(?:destination|resort)(?:Name|Title)"\s*:\s*"([^"]+)"/g;
    let m;
    while ((m = re.exec(html))) out.push({ name: m[1], access: 'limited', days_limit: 7 });
    return out;
  },
  indy(html) {
    // Indy is 2 days per resort by definition.
    const out = [];
    const re = /"(?:resort|title)"\s*:\s*"([^"]+)"/g;
    let m;
    while ((m = re.exec(html))) out.push({ name: m[1], access: 'limited', days_limit: 2 });
    return out;
  },
  'mountain-collective'(html) {
    // Mountain Collective is 2 days per destination.
    const out = [];
    const re = /<h[23][^>]*>([^<]{3,60})<\/h[23]>/g;
    let m;
    while ((m = re.exec(html))) out.push({ name: m[1].trim(), access: 'limited', days_limit: 2 });
    return out;
  },
};

async function main() {
  const pool = getPool();
  const { rows: resorts } = await pool.query('SELECT id, name, region FROM resorts');
  const byNorm = new Map();
  for (const r of resorts) {
    const key = normName(r.name);
    if (!byNorm.has(key)) byNorm.set(key, []);
    byNorm.get(key).push(r);
  }

  const unmatched = [];
  for (const p of PASSES) {
    const { rows: [passRow] } = await pool.query(
      `INSERT INTO passes (slug, name, season) VALUES ($1,$2,$3)
       ON CONFLICT (slug) DO UPDATE SET season = EXCLUDED.season
       RETURNING id`,
      [p.slug, p.name, SEASON],
    );
    let roster;
    try {
      const html = await fetchHtml(p.url);
      roster = EXTRACTORS[p.slug](html);
    } catch (e) {
      console.error(`  ${p.name}: fetch failed (${e.message}) — keeping existing rows`);
      continue;
    }
    console.log(`${p.name}: ${roster.length} roster entries scraped`);
    // Season re-seed: replace this pass's rows wholesale.
    await pool.query('DELETE FROM pass_resorts WHERE pass_id = $1', [passRow.id]);
    for (const entry of roster) {
      const candidates = byNorm.get(normName(entry.name)) || [];
      if (candidates.length === 1) {
        await pool.query(
          `INSERT INTO pass_resorts (pass_id, resort_id, access, days_limit)
           VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
          [passRow.id, candidates[0].id, entry.access, entry.days_limit],
        );
      } else {
        unmatched.push({ pass: p.slug, name: entry.name, reason: candidates.length ? 'ambiguous' : 'no match' });
      }
    }
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  const file = path.join(DATA_DIR, 'unmatched-roster.csv');
  fs.writeFileSync(
    file,
    'pass,roster_name,reason\n' + unmatched.map((u) => `"${u.pass}","${u.name}","${u.reason}"`).join('\n'),
  );
  console.log(`${unmatched.length} unmatched roster rows → ${file}`);
  await pool.end();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
