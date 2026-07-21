import Link from 'next/link';
import { db, geoHubs, geoHub, mToFt, bestPages, recordsPages, prominence, SEASON } from '../../../lib/data.mjs';
import { pageMeta } from '../../../lib/meta.mjs';
import SortableResortTable from '../../../components/SortableResortTable';

export const dynamicParams = false;

export function generateStaticParams() {
  return geoHubs().map((g) => ({ country: g.countrySlug, region: g.regionSlug }));
}

export function generateMetadata({ params }) {
  const g = geoHub(params.country, params.region);
  const top = [...g.resorts].sort((a, b) => prominence(b) - prominence(a)).slice(0, 4);
  return pageMeta({
    title: `${g.region} Ski Resorts: All ${g.resorts.length} Compared by Stats`,
    description: `Every ${g.region} ski resort with vertical, lifts, runs, terrain split and ${SEASON()} pass coverage — ${top.map((r) => r.name).join(', ')} and more, sortable by stat.`,
    path: g.path,
  });
}

export default function GeoHubPage({ params }) {
  const g = geoHub(params.country, params.region);
  const { passesOf } = db();
  const rows = [...g.resorts]
    .sort((a, b) => (b.vertical_m ?? 0) - (a.vertical_m ?? 0))
    .map((r) => ({
      slug: r.slug, name: r.name,
      verticalFt: mToFt(r.vertical_m), summitFt: mToFt(r.summit_elev_m),
      lifts: r.lifts_total, runs: r.runs_total, pctExpert: r.pct_expert,
      night: r.night_skiing ? 'Yes' : 'No',
    }));
  const best = bestPages().filter((b) => b.hub.regionSlug === g.regionSlug);
  const records = recordsPages().filter((p) => p.scope.slug === g.regionSlug);
  const onPass = new Map();
  for (const r of g.resorts) {
    for (const m of passesOf.get(r.slug) || []) {
      onPass.set(m.pass, (onPass.get(m.pass) || 0) + 1);
    }
  }
  const passLinks = [...onPass.entries()].filter(([, n]) => n >= 3);

  return (
    <>
      <nav className="breadcrumbs"><Link href="/">Home</Link> › {g.country} › {g.region}</nav>
      <h1>{g.region} Ski Resorts</h1>
      <p className="sub">
        {g.resorts.length} resorts in {g.region}, {g.country} — click a column to sort.
      </p>

      <SortableResortTable rows={rows} />

      {(best.length > 0 || records.length > 0 || passLinks.length > 0) && (
        <>
          <h2>{g.region} rankings & subsets</h2>
          <div className="grid">
            {best.map((b) => (
              <Link key={b.path} href={b.path}>
                Best in {g.region}: {b.trait.label} <span className="small">{b.resorts.length} ranked</span>
              </Link>
            ))}
            {records.map((p) => (
              <Link key={p.path} href={p.path}>
                {p.metricDef.label} in {g.region} <span className="small">records</span>
              </Link>
            ))}
            {passLinks.map(([pass, n]) => (
              <Link key={pass} href={`/pass/${pass}/${g.regionSlug}`}>
                {db().passBySlug.get(pass).name} in {g.region} <span className="small">{n} resorts</span>
              </Link>
            ))}
          </div>
        </>
      )}
    </>
  );
}
