import Link from 'next/link';
import { db, passRoster, passRegions, mToFt, regionSlug } from '../../../lib/data.mjs';
import { pageMeta } from '../../../lib/meta.mjs';
import RosterTable from '../../../components/RosterTable';

export const dynamicParams = false;

export function generateStaticParams() {
  return db().passes.map((p) => ({ pass: p.slug }));
}

export function generateMetadata({ params }) {
  const p = db().passBySlug.get(params.pass);
  const n = passRoster(p.slug).length;
  return pageMeta({
    // Evergreen canonical URL — the season lives in title/H1/content, never the path.
    title: `${p.name} Resorts ${p.season}: Full List (${n} North American Resorts)`,
    description: `Every ${p.name} resort for ${p.season} with access tier (unlimited vs limited days), vertical, lifts, and runs. Filterable, sortable, updated each season.`,
    path: `/pass/${p.slug}`,
  });
}

export default function PassPage({ params }) {
  const p = db().passBySlug.get(params.pass);
  const roster = passRoster(p.slug);
  const regions = passRegions(p.slug);
  const rows = roster.map((m) => ({
    slug: m.r.slug, name: m.r.name, region: m.r.region, country: m.r.country,
    access: m.access, days_limit: m.days_limit,
    verticalFt: mToFt(m.r.vertical_m), lifts: m.r.lifts_total, runs: m.r.runs_total,
  }));
  const unlimited = roster.filter((m) => m.access === 'unlimited').length;

  return (
    <>
      <nav className="breadcrumbs"><Link href="/">Home</Link> › {p.name}</nav>
      <h1>{p.name} Resorts: {p.season} Roster</h1>
      <p className="sub">
        {roster.length} North American resorts on the {p.name} for {p.season}:{' '}
        {unlimited} unlimited, {roster.length - unlimited} with limited days. This page always
        shows the current season's roster.
      </p>
      <p>
        Comparing passes for a specific set of mountains?{' '}
        <Link href="/ski-pass-finder">Run your list through the pass finder</Link>.
      </p>

      <RosterTable rows={rows} />

      {regions.length > 0 && (
        <>
          <h2>{p.name} by region</h2>
          <div className="grid">
            {regions.map((g) => (
              <Link key={g.regionSlug} href={`/pass/${p.slug}/${g.regionSlug}`}>
                {p.name} in {g.region} <span className="small">{g.members.length} resorts</span>
              </Link>
            ))}
          </div>
        </>
      )}
    </>
  );
}
