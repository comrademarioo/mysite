// Step 1 — Wikidata skeleton pull (CC0).
// SPARQL for instances of ski resort (Q130003) and subclasses: name, coords,
// country, admin region, elevations where present, QID. Upserts into `resorts`.
//
// NOTE: requires outbound HTTPS to query.wikidata.org. If this environment's
// network policy blocks it (403 on CONNECT), enable access for
// query.wikidata.org in the environment settings, then re-run:
//   npm run ingest:wikidata
//
// Geographic scope v1: North America first (US, Canada, Mexico). Rest-of-world
// rows are still stored (inventory), but geo scope keeps the pull polite.
import './proxy.mjs';
import { getPool } from './db.mjs';
import { slugify } from '../lib/slug.mjs';

const ENDPOINT = 'https://query.wikidata.org/sparql';
const USER_AGENT = 'SkivioBot/0.1 (https://skivio.org; contact@skivio.org)';

// Q130003 = ski resort. wdt:P31/wdt:P279* catches subclasses.
// P17 country, P131 admin region, P625 coords, P2044 elevation above sea level.
// Elevations on Wikidata are spotty; OpenSkiMap (step 2) is the authority for
// summit/base/vertical — we only take what's free here.
const QUERY = `
SELECT ?item ?itemLabel ?countryLabel ?regionLabel ?coord ?elev WHERE {
  ?item wdt:P31/wdt:P279* wd:Q130003 .
  ?item wdt:P625 ?coord .
  ?item wdt:P17 ?country .
  OPTIONAL { ?item wdt:P131 ?region . }
  OPTIONAL { ?item wdt:P2044 ?elev . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . }
}
`;

function parsePoint(wkt) {
  // "Point(lng lat)"
  const m = /Point\(([-\d.]+) ([-\d.]+)\)/.exec(wkt || '');
  if (!m) return null;
  return { lng: parseFloat(m[1]), lat: parseFloat(m[2]) };
}

async function sparql(query) {
  const url = `${ENDPOINT}?format=json&query=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/sparql-results+json' },
  });
  if (!res.ok) {
    throw new Error(`Wikidata SPARQL failed: HTTP ${res.status} ${await res.text().then((t) => t.slice(0, 300))}`);
  }
  return res.json();
}

const NA_COUNTRIES = new Set(['United States of America', 'United States', 'Canada', 'Mexico']);
const COUNTRY_NORMALIZE = { 'United States of America': 'United States' };

async function main() {
  console.log('Querying Wikidata for ski resorts (Q130003 + subclasses)…');
  const json = await sparql(QUERY);
  const rows = json.results.bindings;
  console.log(`  ${rows.length} raw rows`);

  // Dedupe by QID (multi-valued region/country can duplicate rows).
  const byQid = new Map();
  for (const r of rows) {
    const qid = r.item.value.split('/').pop();
    const point = parsePoint(r.coord?.value);
    if (!point) continue;
    const name = r.itemLabel?.value;
    if (!name || name === qid) continue; // unlabeled entity — useless as a page
    const country = COUNTRY_NORMALIZE[r.countryLabel?.value] || r.countryLabel?.value;
    if (!country) continue;
    const existing = byQid.get(qid);
    const row = {
      qid,
      name,
      country,
      region: r.regionLabel?.value || existing?.region || null,
      lat: point.lat,
      lng: point.lng,
      elev: r.elev ? Math.round(parseFloat(r.elev.value)) : existing?.elev || null,
    };
    byQid.set(qid, row);
  }

  const all = [...byQid.values()];
  const na = all.filter((r) => NA_COUNTRIES.has(r.country));
  console.log(`  ${all.length} unique entities, ${na.length} in North America (v1 scope)`);

  const pool = getPool();
  const client = await pool.connect();
  let inserted = 0;
  // Clean slug first (vail), region-suffixed only on collision between
  // different entities (crystal-mountain vs crystal-mountain-michigan).
  const slugTaken = new Map(); // slug -> qid
  try {
    await client.query('BEGIN');
    for (const r of all) {
      let slug = slugify(r.name);
      if (slugTaken.has(slug) && slugTaken.get(slug) !== r.qid) {
        slug = slugify(`${r.name}-${r.region || r.country}`);
        let n = 2;
        while (slugTaken.has(slug) && slugTaken.get(slug) !== r.qid) slug = `${slugify(r.name)}-${n++}`;
      }
      slugTaken.set(slug, r.qid);
      await client.query(
        `INSERT INTO resorts (slug, name, country, region, lat, lng, summit_elev_m, wikidata_qid)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (slug) DO UPDATE SET
           name = EXCLUDED.name, country = EXCLUDED.country,
           region = COALESCE(EXCLUDED.region, resorts.region),
           lat = EXCLUDED.lat, lng = EXCLUDED.lng,
           summit_elev_m = COALESCE(resorts.summit_elev_m, EXCLUDED.summit_elev_m),
           wikidata_qid = EXCLUDED.wikidata_qid`,
        [slug, r.name, r.country, r.region, r.lat, r.lng, r.elev, r.qid],
      );
      inserted++;
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
  console.log(`Upserted ${inserted} resorts from Wikidata.`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
