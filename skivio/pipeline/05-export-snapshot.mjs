// Step 5 — export Postgres → data/snapshot.json.
// The Next.js build reads ONLY this snapshot, so builds are reproducible and
// don't need a live database (the snapshot is committed).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool } from './db.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');

async function main() {
  const pool = getPool();
  const { rows: resorts } = await pool.query(`
    SELECT slug, name, country, region, lat::float, lng::float, summit_elev_m, base_elev_m,
           vertical_m, lifts_total, runs_total, pct_beginner, pct_intermediate, pct_expert,
           night_skiing, data_score
    FROM resorts ORDER BY slug`);
  const { rows: passes } = await pool.query('SELECT slug, name, season FROM passes ORDER BY slug');
  const { rows: passResorts } = await pool.query(`
    SELECT p.slug AS pass, r.slug AS resort, pr.access, pr.days_limit
    FROM pass_resorts pr JOIN passes p ON p.id = pr.pass_id JOIN resorts r ON r.id = pr.resort_id
    ORDER BY p.slug, r.slug`);

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(DATA_DIR, 'snapshot.json'),
    JSON.stringify({ generatedFrom: 'postgres', resorts, passes, passResorts }),
  );
  console.log(`Snapshot: ${resorts.length} resorts, ${passes.length} passes, ${passResorts.length} memberships → data/snapshot.json`);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
