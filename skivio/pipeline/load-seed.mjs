// Loads the provisional curated seed into Postgres. Replaced by steps 1-3
// (Wikidata → OpenSkiMap → roster scrape) once network access is available.
// Also emits data/independent-confirmed.json — the manual-confirmation list
// used by scoring for the "pass status known" point on resorts with no pass.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool } from './db.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const seed = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, 'seed', f), 'utf8'));

async function main() {
  const { resorts } = seed('resorts.seed.json');
  const { passes } = seed('passes.seed.json');
  const { memberships } = seed('pass_resorts.seed.json');

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('TRUNCATE pass_resorts, passes, resorts RESTART IDENTITY CASCADE');
    for (const r of resorts) {
      await client.query(
        `INSERT INTO resorts (slug, name, country, region, lat, lng, summit_elev_m, base_elev_m,
           vertical_m, lifts_total, runs_total, pct_beginner, pct_intermediate, pct_expert, night_skiing)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [r.slug, r.name, r.country, r.region, r.lat, r.lng, r.summit_elev_m, r.base_elev_m,
         r.vertical_m, r.lifts_total, r.runs_total, r.pct_beginner, r.pct_intermediate,
         r.pct_expert, r.night_skiing],
      );
    }
    for (const p of passes) {
      await client.query('INSERT INTO passes (slug, name, season) VALUES ($1,$2,$3)', [p.slug, p.name, p.season]);
    }
    for (const m of memberships) {
      await client.query(
        `INSERT INTO pass_resorts (pass_id, resort_id, access, days_limit)
         SELECT p.id, r.id, $3, $4 FROM passes p, resorts r WHERE p.slug = $1 AND r.slug = $2`,
        [m.pass, m.resort, m.access, m.days_limit ?? null],
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  const independent = resorts.filter((r) => r.independent).map((r) => r.slug);
  fs.writeFileSync(
    path.join(DATA_DIR, 'independent-confirmed.json'),
    JSON.stringify({ _comment: 'Resorts confirmed NOT on any tracked pass — grants the pass-status data_score point.', slugs: independent }, null, 2),
  );
  console.log(`Loaded ${resorts.length} resorts, ${passes.length} passes, ${memberships.length} memberships; ${independent.length} confirmed independent.`);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
