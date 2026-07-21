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
    let total = 0;
    for (const [diff, v] of Object.entries(runs)) {
      const n = v?.count ?? (typeof v === 'number' ? v : 0);
      const bucket = mapDiff[diff];
      if (bucket && n > 0) { buckets[bucket] += n; total += n; }
    }
    if (total > 0) {
      out.runs_total = total;
      out.pct_beginner = Math.round((buckets.beginner / total) * 100);
      out.pct_intermediate = Math.round((buckets.intermediate / total) * 100);
      out.pct_expert = Math.round((buckets.expert / total) * 100);
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
    .map((f) => ({
      id: f.properties?.id,
      name: f.properties?.name,
      point: geomPoint(f.geometry),
      stats: extractStats(f.properties || {}),
    }))
    .filter((a) => a.name && a.point);
  console.log(`${areas.length} named OpenSkiMap areas`);

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
           pct_expert    = COALESCE($10, pct_expert)
         WHERE id = $1`,
        [r.id, a.id, s.summit_elev_m, s.base_elev_m, s.vertical_m,
         s.lifts_total, s.runs_total, s.pct_beginner, s.pct_intermediate, s.pct_expert],
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
