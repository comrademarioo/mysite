// Step 2 — OpenSkiMap enrichment (ODbL — attribution required, see footer;
// do not redistribute the enriched database as a database).
//
// Downloads the daily ski_areas GeoJSON and joins onto the Wikidata skeleton
// by name similarity + proximity (coords within ~2km). Ambiguous matches go to
// data/ambiguous-matches.csv for manual review — never silently guessed.
//
// Provides: summit/base elevation, vertical, lift counts, run counts,
// difficulty splits (from the per-area `statistics` block).
//
// NOTE: requires outbound HTTPS to tiles.openskimap.org. If blocked by the
// environment network policy, enable that host and re-run:
//   npm run ingest:openskimap
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './proxy.mjs';
import { getPool } from './db.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const SKI_AREAS_URL = 'https://tiles.openskimap.org/geojson/ski_areas.geojson';
const CACHE = path.join(DATA_DIR, 'ski_areas.geojson');
const MATCH_RADIUS_KM = 2;

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function normName(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\b(ski (resort|area|hill|mountain)|resort|mountain resort)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function nameSimilar(a, b) {
  const na = normName(a);
  const nb = normName(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

// Pull a representative point from any GeoJSON geometry.
function geomPoint(geom) {
  if (!geom) return null;
  if (geom.type === 'Point') return { lng: geom.coordinates[0], lat: geom.coordinates[1] };
  const flat = [];
  (function walk(c) {
    if (typeof c[0] === 'number') flat.push(c);
    else c.forEach(walk);
  })(geom.coordinates);
  if (!flat.length) return null;
  const lng = flat.reduce((s, c) => s + c[0], 0) / flat.length;
  const lat = flat.reduce((s, c) => s + c[1], 0) / flat.length;
  return { lng, lat };
}

// OpenSkiMap per-area statistics → our columns.
function extractStats(props) {
  const s = props.statistics || {};
  const out = {};
  const max = s.maxElevation ?? s.max_elevation;
  const min = s.minElevation ?? s.min_elevation;
  if (max != null) out.summit_elev_m = Math.round(max);
  if (min != null) out.base_elev_m = Math.round(min);
  if (max != null && min != null) out.vertical_m = Math.round(max - min);
  const lifts = s.lifts?.byType ?? s.lifts;
  if (lifts) {
    let count = 0;
    for (const v of Object.values(lifts)) count += v?.count ?? (typeof v === 'number' ? v : 0);
    if (count > 0) out.lifts_total = count;
  }
  const runs = s.runs?.byActivity?.downhill?.byDifficulty ?? s.runs?.byDifficulty;
  if (runs) {
    const buckets = { beginner: 0, intermediate: 0, expert: 0 };
    const mapDiff = {
      novice: 'beginner', easy: 'beginner', beginner: 'beginner',
      intermediate: 'intermediate',
      advanced: 'expert', expert: 'expert', extreme: 'expert', freeride: 'expert',
    };
    let classified = 0, total = 0;
    for (const [diff, v] of Object.entries(runs)) {
      const n = v?.count ?? (typeof v === 'number' ? v : 0);
      if (n <= 0) continue;
      total += n; // includes 'other' — it is still a run
      const bucket = mapDiff[diff];
      if (bucket) { buckets[bucket] += n; classified += n; }
    }
    if (total > 0) out.runs_total = total;
    if (classified > 0) {
      // Split over classified runs only; force the three to sum to 100.
      out.pct_beginner = Math.round((buckets.beginner / classified) * 100);
      out.pct_intermediate = Math.round((buckets.intermediate / classified) * 100);
      out.pct_expert = 100 - out.pct_beginner - out.pct_intermediate;
    }
  }
  return out;
}

async function download() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(CACHE)) {
    console.log(`Using cached ${CACHE}`);
    return CACHE;
  }
  console.log(`Downloading ${SKI_AREAS_URL} …`);
  const res = await fetch(SKI_AREAS_URL);
  if (!res.ok) throw new Error(`OpenSkiMap download failed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(CACHE, buf);
  console.log(`  saved ${(buf.length / 1e6).toFixed(1)} MB`);
  return CACHE;
}

async function main() {
  const file = await download();
  const geo = JSON.parse(fs.readFileSync(file, 'utf8'));
  const areas = geo.features
    .filter((f) => {
      const st = f.properties?.status;
      return (st === 'operating' || st == null) && // exclude abandoned/proposed/etc.
        (f.properties?.activities || []).includes('downhill');
    })
    .map((f) => {
      const loc = (f.properties?.places || [])
        .map((p) => p?.localized?.en)
        .find((l) => l?.region || l?.country);
      return {
        id: f.properties?.id,
        name: f.properties?.name,
        point: geomPoint(f.geometry),
        stats: extractStats(f.properties || {}),
        region: loc?.region || null,   // proper state/province — Wikidata P131
        country: loc?.country || null, // gives counties in the US, unusable for hubs
      };
    })
    .filter((a) => a.name && a.point);
  console.log(`${areas.length} named, operating, downhill OpenSkiMap areas`);

  const pool = getPool();
  const { rows: resorts } = await pool.query(
    'SELECT id, slug, name, lat, lng FROM resorts',
  );

  const ambiguous = [];
  let matched = 0;
  for (const r of resorts) {
    const nearby = areas.filter(
      (a) => haversineKm(Number(r.lat), Number(r.lng), a.point.lat, a.point.lng) <= MATCH_RADIUS_KM,
    );
    let candidates = nearby.filter((a) => nameSimilar(a.name, r.name));
    if (candidates.length === 0 && nearby.length === 1) candidates = nearby; // lone area within 2km
    if (candidates.length === 1) {
      const a = candidates[0];
      const s = a.stats;
      await pool.query(
        `UPDATE resorts SET
           openskimap_id = $2,
           summit_elev_m = COALESCE($3, summit_elev_m),
           base_elev_m   = COALESCE($4, base_elev_m),
           vertical_m    = COALESCE($5, vertical_m),
           lifts_total   = COALESCE($6, lifts_total),
           runs_total    = COALESCE($7, runs_total),
           pct_beginner  = COALESCE($8, pct_beginner),
           pct_intermediate = COALESCE($9, pct_intermediate),
           pct_expert    = COALESCE($10, pct_expert),
           region  = COALESCE($11, region),
           country = COALESCE($12, country)
         WHERE id = $1`,
        [r.id, a.id, s.summit_elev_m, s.base_elev_m, s.vertical_m,
         s.lifts_total, s.runs_total, s.pct_beginner, s.pct_intermediate, s.pct_expert,
         a.region, a.country],
      );
      matched++;
    } else if (candidates.length > 1) {
      // Manual review, not silent guesses.
      ambiguous.push({
        resort_slug: r.slug,
        resort_name: r.name,
        candidates: candidates.map((c) => `${c.id}:${c.name}`).join(' | '),
      });
    }
  }

  // Two Wikidata entities matched to the same physical ski area = duplicates
  // (e.g. "Palisades Tahoe" + legacy "Squaw Valley" entities). Keep the row
  // with the higher stat completeness (then shorter slug), drop the rest.
  const { rows: dupes } = await pool.query(`
    SELECT openskimap_id, array_agg(id ORDER BY
      (CASE WHEN vertical_m IS NOT NULL THEN 1 ELSE 0 END +
       CASE WHEN lifts_total IS NOT NULL THEN 1 ELSE 0 END +
       CASE WHEN runs_total IS NOT NULL THEN 1 ELSE 0 END) DESC,
      length(slug) ASC) AS ids
    FROM resorts WHERE openskimap_id IS NOT NULL
    GROUP BY openskimap_id HAVING count(*) > 1`);
  let removed = 0;
  for (const d of dupes) {
    const [, ...losers] = d.ids;
    await pool.query('DELETE FROM pass_resorts WHERE resort_id = ANY($1)', [losers]);
    const res = await pool.query('DELETE FROM resorts WHERE id = ANY($1)', [losers]);
    removed += res.rowCount;
  }
  if (removed) console.log(`Deduped ${removed} rows that shared an OpenSkiMap area`);

  // NA rows that never matched OpenSkiMap still carry Wikidata P131 county
  // labels; those are not hub-grade regions — null them so no county hubs form.
  const { rowCount: blanked } = await pool.query(`
    UPDATE resorts SET region = NULL
    WHERE country IN ('United States', 'Canada') AND openskimap_id IS NULL
      AND region NOT IN (
      'Alabama','Alaska','Arizona','Arkansas','California','Colorado','Connecticut','Delaware',
      'Florida','Georgia','Hawaii','Idaho','Illinois','Indiana','Iowa','Kansas','Kentucky',
      'Louisiana','Maine','Maryland','Massachusetts','Michigan','Minnesota','Mississippi',
      'Missouri','Montana','Nebraska','Nevada','New Hampshire','New Jersey','New Mexico',
      'New York','North Carolina','North Dakota','Ohio','Oklahoma','Oregon','Pennsylvania',
      'Rhode Island','South Carolina','South Dakota','Tennessee','Texas','Utah','Vermont',
      'Virginia','Washington','West Virginia','Wisconsin','Wyoming',
      'Alberta','British Columbia','Manitoba','New Brunswick','Newfoundland and Labrador',
      'Nova Scotia','Ontario','Prince Edward Island','Quebec','Saskatchewan','Yukon',
      'Northwest Territories','Nunavut')`);
  if (blanked) console.log(`Nulled ${blanked} county-grade region labels on unmatched NA rows`);

  // Rows that ended with no region (ambiguous OSM match + county-grade P131)
  // inherit the region of the nearest same-country resort within 150 km —
  // e.g. Whistler Blackcomb sits between the separate "Whistler" and
  // "Blackcomb" OSM areas and needs British Columbia from a neighbor.
  const { rowCount: backfilled } = await pool.query(`
    UPDATE resorts r SET region = (
      SELECT r2.region FROM resorts r2
      WHERE r2.region IS NOT NULL AND r2.country = r.country AND r2.id <> r.id
        AND 2*6371*asin(sqrt( power(sin(radians(r2.lat - r.lat)/2),2) +
            cos(radians(r.lat))*cos(radians(r2.lat))*power(sin(radians(r2.lng - r.lng)/2),2) )) <= 150
      ORDER BY 2*6371*asin(sqrt( power(sin(radians(r2.lat - r.lat)/2),2) +
            cos(radians(r.lat))*cos(radians(r2.lat))*power(sin(radians(r2.lng - r.lng)/2),2) ))
      LIMIT 1)
    WHERE r.region IS NULL`);
  if (backfilled) console.log(`Backfilled region from nearest neighbor for ${backfilled} rows`);

  const reviewFile = path.join(DATA_DIR, 'ambiguous-matches.csv');
  fs.writeFileSync(
    reviewFile,
    'resort_slug,resort_name,candidates\n' +
      ambiguous.map((a) => `"${a.resort_slug}","${a.resort_name}","${a.candidates}"`).join('\n'),
  );
  console.log(`Matched ${matched}/${resorts.length}; ${ambiguous.length} ambiguous → ${reviewFile}`);
  await pool.end();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
