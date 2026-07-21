// Step 4 — data_score computation + floor report.
// +1 each for: vertical, lifts_total, runs_total, complete terrain split,
// pass status known (on a pass OR confirmed independent).
// Floors (enforced at page generation, reported here):
//   resort page:      data_score >= 3
//   vs-page:          BOTH resorts data_score >= 4
//   filter/geo pages: >= 3 qualifying resorts
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool } from './db.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');

async function main() {
  const pool = getPool();
  let independent = [];
  try {
    independent = JSON.parse(
      fs.readFileSync(path.join(DATA_DIR, 'independent-confirmed.json'), 'utf8'),
    ).slugs;
  } catch { /* no confirmations file yet */ }

  await pool.query(
    `UPDATE resorts r SET data_score =
       (CASE WHEN vertical_m IS NOT NULL THEN 1 ELSE 0 END) +
       (CASE WHEN lifts_total IS NOT NULL THEN 1 ELSE 0 END) +
       (CASE WHEN runs_total IS NOT NULL THEN 1 ELSE 0 END) +
       (CASE WHEN pct_beginner IS NOT NULL AND pct_intermediate IS NOT NULL AND pct_expert IS NOT NULL THEN 1 ELSE 0 END) +
       (CASE WHEN EXISTS (SELECT 1 FROM pass_resorts pr WHERE pr.resort_id = r.id)
              OR r.slug = ANY($1::text[]) THEN 1 ELSE 0 END)`,
    [independent],
  );

  const { rows: dist } = await pool.query(
    'SELECT data_score, count(*)::int FROM resorts GROUP BY data_score ORDER BY data_score DESC',
  );
  const { rows: [{ n: resortPages }] } = await pool.query(
    'SELECT count(*)::int AS n FROM resorts WHERE data_score >= 3',
  );

  // Vs-page candidates: same region OR same pass, both >= 4, alphabetical pair order.
  const { rows: [{ n: vsPages }] } = await pool.query(`
    SELECT count(*)::int AS n FROM (
      SELECT DISTINCT least(a.slug, b.slug) AS s1, greatest(a.slug, b.slug) AS s2
      FROM resorts a
      JOIN resorts b ON a.slug < b.slug
      WHERE a.data_score >= 4 AND b.data_score >= 4
        AND (
          (a.country = b.country AND a.region = b.region)
          OR EXISTS (
            SELECT 1 FROM pass_resorts pa
            JOIN pass_resorts pb ON pa.pass_id = pb.pass_id
            WHERE pa.resort_id = a.id AND pb.resort_id = b.id
          )
        )
    ) q`);

  const { rows: geo } = await pool.query(`
    SELECT country, region, count(*)::int AS n FROM resorts
    WHERE data_score >= 3 AND region IS NOT NULL
    GROUP BY country, region HAVING count(*) >= 3 ORDER BY n DESC`);

  const { rows: passCounts } = await pool.query(`
    SELECT p.slug, count(pr.resort_id)::int AS n
    FROM passes p LEFT JOIN pass_resorts pr ON pr.pass_id = p.id
    GROUP BY p.slug ORDER BY n DESC`);

  const report = [
    '=== Skivio floor report ===',
    `data_score distribution: ${dist.map((d) => `${d.data_score}:${d.count}`).join('  ')}`,
    `resort pages (score>=3):        ${resortPages}`,
    `vs pages (both>=4, same region/pass, alphabetical): ${vsPages}`,
    `geo hub pages (>=3 qualifying): ${geo.length}`,
    `pass hub pages:                 ${passCounts.length} (${passCounts.map((p) => `${p.slug}:${p.n}`).join(', ')})`,
    '',
    'Geo hubs:',
    ...geo.map((g) => `  ${g.country} / ${g.region}: ${g.n}`),
  ].join('\n');

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, 'floor-report.txt'), report + '\n');
  console.log(report);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
