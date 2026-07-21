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
import { slugify } from '../lib/slug.mjs';

// Some rosters list an umbrella name that maps to several resort rows.
// Without expansion, Mountain Collective's "Aspen Snowmass" entry matches
// nothing and Aspen silently drops off the pass.
const ALIASES = {
  'aspen snowmass': ['Aspen Mountain', 'Aspen Highlands', 'Buttermilk', 'Snowmass'],
  'big bear': ['Bear Mountain', 'Snow Summit'],
};

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

// Minimal reader for the cached OpenSkiMap dump (canonical parsing lives in
// 02-openskimap-enrich.mjs) — used for roster-driven resort discovery.
function loadOsmAreas() {
  const cache = path.join(DATA_DIR, 'ski_areas.geojson');
  if (!fs.existsSync(cache)) return null;
  const geo = JSON.parse(fs.readFileSync(cache, 'utf8'));
  return geo.features
    .filter((f) => {
      const st = f.properties?.status;
      return (st === 'operating' || st == null) && (f.properties?.activities || []).includes('downhill');
    })
    .map((f) => {
      const flat = [];
      (function walk(c) { if (typeof c[0] === 'number') flat.push(c); else c.forEach(walk); })(
        f.geometry?.type === 'Point' ? [f.geometry.coordinates] : f.geometry?.coordinates || []);
      if (!flat.length) return null;
      const point = {
        lng: flat.reduce((s, c) => s + c[0], 0) / flat.length,
        lat: flat.reduce((s, c) => s + c[1], 0) / flat.length,
      };
      const loc = (f.properties?.places || []).map((p) => p?.localized?.en).find((l) => l?.region || l?.country);
      const s = f.properties?.statistics || {};
      const stats = {};
      if (s.maxElevation != null) stats.summit_elev_m = Math.round(s.maxElevation);
      if (s.minElevation != null) stats.base_elev_m = Math.round(s.minElevation);
      if (s.maxElevation != null && s.minElevation != null) stats.vertical_m = Math.round(s.maxElevation - s.minElevation);
      const lifts = s.lifts?.byType;
      if (lifts) {
        const n = Object.values(lifts).reduce((acc, v) => acc + (v?.count || 0), 0);
        if (n > 0) stats.lifts_total = n;
      }
      const runs = s.runs?.byActivity?.downhill?.byDifficulty;
      if (runs) {
        const mapDiff = { novice: 'beginner', easy: 'beginner', beginner: 'beginner', intermediate: 'intermediate', advanced: 'expert', expert: 'expert', extreme: 'expert', freeride: 'expert' };
        const buckets = { beginner: 0, intermediate: 0, expert: 0 };
        let classified = 0, total = 0;
        for (const [diff, v] of Object.entries(runs)) {
          const n = v?.count || 0;
          if (n <= 0) continue;
          total += n;
          if (mapDiff[diff]) { buckets[mapDiff[diff]] += n; classified += n; }
        }
        if (total > 0) stats.runs_total = total;
        if (classified > 0) {
          stats.pct_beginner = Math.round((buckets.beginner / classified) * 100);
          stats.pct_intermediate = Math.round((buckets.intermediate / classified) * 100);
          stats.pct_expert = 100 - stats.pct_beginner - stats.pct_intermediate;
        }
      }
      return { id: f.properties?.id, name: f.properties?.name, point, stats, region: loc?.region || null, country: loc?.country || null };
    })
    .filter((a) => a && a.name);
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
    const expanded = roster.flatMap((entry) => {
      const kids = ALIASES[norm(entry.name)];
      return kids ? kids.map((name) => ({ ...entry, name, lat: null, lng: null })) : [entry];
    });
    for (const entry of expanded) {
      const { hit, reason } = matchResort(entry);
      if (!hit) { unmatched.push({ pass: p.slug, passId: passRow.id, name: entry.name, reason, entry }); continue; }
      const prev = tierByResort.get(hit.id);
      await pool.query(
        `INSERT INTO pass_resorts (pass_id, resort_id, access, days_limit)
         VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
        [passRow.id, hit.id, prev?.access ?? entry.access, prev ? prev.days_limit : entry.days_limit]);
      inserted++;
    }
    console.log(`  ${inserted} matched → pass_resorts (tiers kept from prior rows where present)`);
  }

  // Roster-driven discovery: a roster entry that matches nothing in the DB is
  // often a real ski area that Wikidata's class tree missed (plenty of Indy
  // hills). If OpenSkiMap knows exactly one operating downhill area by that
  // name (near the roster coords when we have them), create the resort from
  // OSM data and attach the membership. Nordic centers never match because
  // the area list is downhill-only, so they stay in the review file.
  const stillUnmatched = [];
  const osmAreas = loadOsmAreas();
  if (osmAreas) {
    let discovered = 0;
    for (const u of unmatched) {
      let cands = osmAreas.filter((a) => similar(u.name, a.name));
      if (u.entry.lat != null && u.entry.lng != null) {
        cands = cands.filter((a) => haversineKm(u.entry.lat, u.entry.lng, a.point.lat, a.point.lng) <= 40);
      }
      if (cands.length !== 1) { stillUnmatched.push(u); continue; }
      const a = cands[0];
      // If a name-similar resort already exists near this OSM area, the roster
      // name just differed from the DB name (Tamarack vs "Tamarack Resort") —
      // attach the membership there instead of inserting a duplicate.
      const { rows: existing } = await pool.query(
        `SELECT id, name FROM resorts WHERE
           2*6371*asin(sqrt( power(sin(radians(lat - $1)/2),2) +
             cos(radians($1))*cos(radians(lat))*power(sin(radians(lng - $2)/2),2) )) <= 40`,
        [a.point.lat, a.point.lng]);
      const near = existing.find((e) => similar(e.name, a.name) || similar(e.name, u.name));
      if (near) {
        await pool.query(
          `INSERT INTO pass_resorts (pass_id, resort_id, access, days_limit)
           VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
          [u.passId, near.id, u.entry.access, u.entry.days_limit]);
        discovered++;
        continue;
      }
      let slug = slugify(a.name);
      const { rows: [taken] } = await pool.query('SELECT 1 FROM resorts WHERE slug = $1', [slug]);
      if (taken) slug = slugify(`${a.name}-${a.region || a.country || 'osm'}`);
      const { rows: [row] } = await pool.query(
        `INSERT INTO resorts (slug, name, country, region, lat, lng, summit_elev_m, base_elev_m,
           vertical_m, lifts_total, runs_total, pct_beginner, pct_intermediate, pct_expert, openskimap_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT (slug) DO NOTHING RETURNING id`,
        [slug, a.name, a.country || 'Unknown', a.region, a.point.lat, a.point.lng,
         a.stats.summit_elev_m, a.stats.base_elev_m, a.stats.vertical_m, a.stats.lifts_total,
         a.stats.runs_total, a.stats.pct_beginner, a.stats.pct_intermediate, a.stats.pct_expert, a.id]);
      if (!row) { stillUnmatched.push(u); continue; }
      await pool.query(
        `INSERT INTO pass_resorts (pass_id, resort_id, access, days_limit)
         VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
        [u.passId, row.id, u.entry.access, u.entry.days_limit]);
      discovered++;
    }
    console.log(`Discovered ${discovered} roster resorts from OpenSkiMap (missing from the skeleton)`);
  } else {
    stillUnmatched.push(...unmatched);
    console.log('No cached ski_areas.geojson; skipping roster-driven discovery');
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  const file = path.join(DATA_DIR, 'unmatched-roster.csv');
  fs.writeFileSync(
    file,
    'pass,roster_name,reason\n' + stillUnmatched.map((u) => `"${u.pass}","${u.name}","${u.reason}"`).join('\n') + '\n');
  console.log(`${stillUnmatched.length} unmatched roster rows → ${file}`);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
