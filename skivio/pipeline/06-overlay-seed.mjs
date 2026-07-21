// Overlay curated seed knowledge onto the pipeline-built skeleton.
// The Wikidata+OpenSkiMap rows are authoritative; the seed contributes only
// what those sources lack:
//   - night_skiing (not in OpenSkiMap area statistics)
//   - stat gap-fill where OpenSkiMap had no match (COALESCE semantics)
//   - the confirmed-independent list (mapped to the new slugs)
//   - pass rosters as a verified fallback — the roster scrape (step 3) replaces
//     them per-pass whenever it succeeds; on scrape failure these rows stand.
// Seed rows are matched to DB rows by name similarity + proximity (<= 2 km),
// mirroring the OpenSkiMap join. Unmatched seed rows are reported, not forced.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool } from './db.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const seed = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, 'seed', f), 'utf8'));

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/\bmt\b\.?/g, 'mount').replace(/\bmtn\b\.?/g, 'mountain')
  .replace(/\b(ski (resort|area|hill|valley|mountain|and snowboard park)|resort|mountain resort|park)\b/g, '')
  .replace(/[^a-z0-9]+/g, ' ').trim();
const similar = (a, b) => {
  const na = norm(a), nb = norm(b);
  return !!na && !!nb && (na === nb || na.includes(nb) || nb.includes(na));
};

async function main() {
  const { resorts: seedResorts } = seed('resorts.seed.json');
  const { memberships } = seed('pass_resorts.seed.json');
  const { passes } = seed('passes.seed.json');

  const pool = getPool();
  const { rows: dbResorts } = await pool.query(
    'SELECT id, slug, name, lat::float, lng::float FROM resorts');

  // seed slug -> db row
  const mapping = new Map();
  const unmatchedSeed = [];
  for (const s of seedResorts) {
    // Seed coords are approximate (hand-entered) — allow 15 km with a name
    // match; failing that, accept a UNIQUE candidate within 1.5 km (renames
    // like Purgatory ↔ Durango Mountain Resort).
    const near = dbResorts
      .map((d) => ({ d, km: haversineKm(s.lat, s.lng, d.lat, d.lng) }))
      .sort((a, b) => a.km - b.km);
    const named = near.filter((x) => x.km <= 15 && similar(s.name, x.d.name));
    const lone = near.filter((x) => x.km <= 1.5);
    if (named.length) mapping.set(s.slug, named[0].d);
    else if (lone.length === 1) mapping.set(s.slug, lone[0].d);
    else unmatchedSeed.push(s);
  }
  console.log(`Seed→pipeline mapping: ${mapping.size}/${seedResorts.length} matched`);

  // Seed rows with no counterpart are real resorts missing from the Wikidata
  // class tree (Taos, Sun Valley, …) — insert them; step 2 re-run enriches.
  for (const s of unmatchedSeed) {
    // Never fuse onto an existing row via slug collision — a same-slug row is
    // by definition a DIFFERENT resort here (matching already failed), e.g.
    // Snow Valley CA vs Snow Valley ON. Suffix with the region instead.
    const { rows: [taken] } = await pool.query('SELECT 1 FROM resorts WHERE slug = $1', [s.slug]);
    const slug = taken ? `${s.slug}-${String(s.region || s.country).toLowerCase().replace(/[^a-z0-9]+/g, '-')}` : s.slug;
    const { rows: [ins] } = await pool.query(
      `INSERT INTO resorts (slug, name, country, region, lat, lng, summit_elev_m, base_elev_m,
         vertical_m, lifts_total, runs_total, pct_beginner, pct_intermediate, pct_expert, night_skiing)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (slug) DO NOTHING
       RETURNING id, slug, name, lat::float, lng::float`,
      [slug, s.name, s.country, s.region, s.lat, s.lng, s.summit_elev_m, s.base_elev_m,
       s.vertical_m, s.lifts_total, s.runs_total, s.pct_beginner, s.pct_intermediate,
       s.pct_expert, s.night_skiing]);
    if (ins) mapping.set(s.slug, ins);
  }
  if (unmatchedSeed.length) {
    console.log(`  inserted ${unmatchedSeed.length} seed-only resorts missing from the skeleton: ${unmatchedSeed.map((s) => s.slug).join(', ')}`);
  }

  // Overlay stats + night skiing.
  for (const s of seedResorts) {
    const d = mapping.get(s.slug);
    if (!d) continue;
    await pool.query(
      `UPDATE resorts SET
         night_skiing = COALESCE(night_skiing, $2),
         summit_elev_m = COALESCE(summit_elev_m, $3),
         base_elev_m = COALESCE(base_elev_m, $4),
         vertical_m = COALESCE(vertical_m, $5),
         lifts_total = COALESCE(lifts_total, $6),
         runs_total = COALESCE(runs_total, $7),
         pct_beginner = COALESCE(pct_beginner, $8),
         pct_intermediate = COALESCE(pct_intermediate, $9),
         pct_expert = COALESCE(pct_expert, $10)
       WHERE id = $1`,
      [d.id, s.night_skiing, s.summit_elev_m, s.base_elev_m, s.vertical_m,
       s.lifts_total, s.runs_total, s.pct_beginner, s.pct_intermediate, s.pct_expert],
    );
  }

  // Passes + fallback rosters (step 3 replaces per-pass on successful scrape).
  for (const p of passes) {
    await pool.query(
      `INSERT INTO passes (slug, name, season) VALUES ($1,$2,$3)
       ON CONFLICT (slug) DO UPDATE SET season = EXCLUDED.season`,
      [p.slug, p.name, p.season]);
  }
  let rosterRows = 0, rosterSkipped = 0;
  for (const m of memberships) {
    const d = mapping.get(m.resort);
    if (!d) { rosterSkipped++; continue; }
    const res = await pool.query(
      `INSERT INTO pass_resorts (pass_id, resort_id, access, days_limit)
       SELECT p.id, $2, $3, $4 FROM passes p WHERE p.slug = $1
       ON CONFLICT DO NOTHING`,
      [m.pass, d.id, m.access, m.days_limit ?? null]);
    rosterRows += res.rowCount;
  }
  console.log(`Fallback rosters: ${rosterRows} rows (${rosterSkipped} skipped — seed resort not in skeleton)`);

  // Independence list, translated to pipeline slugs.
  const independent = seedResorts
    .filter((s) => s.independent && mapping.has(s.slug))
    .map((s) => mapping.get(s.slug).slug);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(DATA_DIR, 'independent-confirmed.json'),
    JSON.stringify({ _comment: 'Resorts confirmed NOT on any tracked pass — grants the pass-status data_score point.', slugs: independent }, null, 2),
  );
  console.log(`${independent.length} confirmed-independent resorts recorded`);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
